package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go"
	"firebase.google.com/go/auth"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"google.golang.org/api/iterator"
)

type FileMeta struct {
	FileName   string      `json:"fileName"`
	FilePath   string      `json:"filePath"`
	NodeID     []string    `json:"nodeId"`
	SharedWith string      `json:"sharedWith"`
	Size       string      `json:"size"`
	Timestamp  interface{} `json:"timestamp" firestore:"timestamp"`
	UserID     string      `json:"userId"`
}

const (
	ChunkSize           = 1 * 1024 * 1024 // 1MB per chunk
	ReplicationFactor   = 2
	ReplicateMaxRetries = 3
	ReplicateRetryDelay = 2 * time.Second
)

var firebaseAuth *auth.Client
var firestoreClient *firestore.Client

func init() {
	log.SetOutput(os.Stdout)
	log.SetFlags(log.LstdFlags | log.Lshortfile)
}

func initFirebase() {
	ctx := context.Background()
	app, err := firebase.NewApp(ctx, nil)
	if err != nil {
		log.Fatalf("error initializing Firebase app: %v", err)
	}

	client, err := app.Auth(ctx)
	if err != nil {
		log.Fatalf("error getting Auth client: %v", err)
	}
	firebaseAuth = client

	fsClient, err := app.Firestore(ctx)
	if err != nil {
		log.Fatalf("error getting Firestore client: %v", err)
	}
	firestoreClient = fsClient
}

func getFileMetadataFromFirebase(userID, filename string) (*FileMeta, error) {
	ctx := context.Background()

	if firestoreClient == nil {
		return nil, fmt.Errorf("Firestore client not initialized")
	}

	iter := firestoreClient.Collection("files").
		Where("userId", "==", userID).
		Where("fileName", "==", filename).
		Limit(1).
		Documents(ctx)

	doc, err := iter.Next()
	if err != nil {
		return nil, fmt.Errorf("file not found")
	}

	var f FileMeta
	if err := doc.DataTo(&f); err != nil {
		return nil, err
	}
	return &f, nil
}

func getFileNodesFromDB(userID, filename string) ([]string, error) {
	meta, err := getFileMetadataFromFirebase(userID, filename)
	if err != nil {
		return nil, err
	}
	return meta.NodeID, nil
}

func deleteFileMetadataFromFirebase(userID, filename string) error {
	ctx := context.Background()
	iter := firestoreClient.Collection("files").
		Where("userId", "==", userID).
		Where("fileName", "==", filename).
		Documents(ctx)

	batch := firestoreClient.Batch()
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return err
		}
		batch.Delete(doc.Ref)
	}

	_, err := batch.Commit(ctx)
	return err
}

// -------------------- Helpers: ENV & Paths --------------------

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func storageRoot() string {
	return getEnv("STORAGE_ROOT", "/app/storage")
}

func peersList() []string {
	nodeID := getEnv("NODE_ID", "s1")
	allNodes := map[string][]string{
		"s1": {"http://s2:8080", "http://s3:8080"},
		"s2": {"http://s1:8080", "http://s3:8080"},
		"s3": {"http://s1:8080", "http://s2:8080"},
	}
	peers, ok := allNodes[nodeID]
	if !ok {
		return []string{}
	}
	return peers
}

func selfURL() string {
	nodeID := getEnv("NODE_ID", "s1")
	return fmt.Sprintf("http://%s:8080", nodeID)
}

func ensureDir(path string) error {
	return os.MkdirAll(path, 0o755)
}

func parseNodeID(node string) string {
	// http://s1:8080 → s1
	if strings.HasPrefix(node, "http://") || strings.HasPrefix(node, "https://") {
		u, err := url.Parse(node)
		if err != nil {
			return node
		}
		host := u.Hostname()
		return host
	}
	return node
}

// -------------------- Chunks I/O --------------------

func writeChunks(userID, filename string, data []byte) (int, error) {
	filename = filepath.Base(filename)
	dir := filepath.Join(storageRoot(), getEnv("NODE_ID", "s1"), userID, filename)
	if err := ensureDir(dir); err != nil {
		return 0, err
	}
	count := 0
	for offset := 0; offset < len(data); offset += ChunkSize {
		end := offset + ChunkSize
		if end > len(data) {
			end = len(data)
		}
		chunkPath := filepath.Join(dir, fmt.Sprintf("%d.chunk", count))
		if err := os.WriteFile(chunkPath, data[offset:end], 0o644); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func reconstructToWriter(nodeID, userID, filename string, w io.Writer) (int64, error) {
	dir := filepath.Join(storageRoot(), nodeID, userID, filename)
	log.Printf("[reconstruct] reading dir: %s", dir)

	var total int64
	for i := 0; ; i++ {
		chunkPath := filepath.Join(dir, fmt.Sprintf("%d.chunk", i))
		log.Printf("[reconstruct] checking chunk: %s", chunkPath)
		if _, err := os.Stat(chunkPath); os.IsNotExist(err) {
			break
		}
		b, err := os.ReadFile(chunkPath)
		if err != nil {
			return total, err
		}
		n, err := w.Write(b)
		if err != nil {
			return total, err
		}
		total += int64(n)
	}

	if total == 0 {
		return 0, fmt.Errorf("no chunks for %s", filename)
	}
	return total, nil
}

func hasAnyChunk(nodeID, userID, filename string) bool {
	dir := filepath.Join(storageRoot(), nodeID, userID, filename)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".chunk" {
			return true
		}
	}
	return false
}

// -------------------- Health Check & Node Selection --------------------

var lastHealthy = make(map[string]time.Time)

func isNodeHealthy(nodeURL string) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(nodeURL + "/health")
	if err == nil && resp.StatusCode == 200 {
		lastHealthy[nodeURL] = time.Now()
		resp.Body.Close()
		return true
	}

	if t, ok := lastHealthy[nodeURL]; ok && time.Since(t) < 1*time.Minute {
		return true
	}

	return false
}

func getHealthyNodes() []string {
	var healthy []string
	for _, peer := range peersList() {
		if isNodeHealthy(peer) {
			healthy = append(healthy, peer)
		}
	}
	return healthy
}

func getFileCount(nodeURL, userID string) int {
	if nodeURL == selfURL() {
		nodeID := getEnv("NODE_ID", "s1")
		root := filepath.Join(storageRoot(), nodeID, userID)
		entries, err := os.ReadDir(root)
		if err != nil {
			return 0
		}
		count := 0
		for _, e := range entries {
			if e.IsDir() && hasAnyChunk(nodeID, userID, e.Name()) {
				count++
			}
		}
		return count
	} else {
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get(nodeURL + "/files")
		if err != nil {
			return 0
		}
		defer resp.Body.Close()

		var data struct {
			Files []struct {
				Name   string `json:"name"`
				UserID string `json:"user_id"`
			} `json:"files"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
			return 0
		}

		count := 0
		for _, f := range data.Files {
			if f.UserID == userID {
				count++
			}
		}
		return count
	}
}

func chooseTargetNode(userID string) string {
	healthyNodes := getHealthyNodes()
	allNodes := append(healthyNodes, selfURL())

	if len(allNodes) == 0 {
		return selfURL()
	}

	type nodeCount struct {
		url   string
		count int
	}
	var nodes []nodeCount
	for _, node := range allNodes {
		nodes = append(nodes, nodeCount{url: node, count: getFileCount(node, userID)})
	}

	if len(nodes) == 0 {
		return selfURL()
	}

	minNode := nodes[0]
	for _, n := range nodes[1:] {
		if n.count < minNode.count {
			minNode = n
		}
	}
	log.Printf("[load-balance] selected node %s with %d files for user %s", minNode.url, minNode.count, userID)
	return minNode.url
}

// -------------------- Replication --------------------

func hasFileOnPeer(userID, peer, filename string) bool {
	encoded := url.PathEscape(filename)
	client := &http.Client{Timeout: 3 * time.Second}

	urlStr := fmt.Sprintf("%s/files/raw/%s/%s", peer, url.PathEscape(userID), encoded)
	req, err := http.NewRequest(http.MethodHead, urlStr, nil)
	if err != nil {
		log.Printf("[hasFileOnPeer] request creation failed: %v", err)
		return false
	}

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK
}

func replicateToPeers(userID, filename string, data []byte) []string {
	healthy := getHealthyNodes()
	storedNodes := []string{selfURL()}
	count := 1

	for _, peer := range healthy {
		if peer == selfURL() {
			continue
		}
		if hasFileOnPeer(userID, peer, filename) {
			storedNodes = append(storedNodes, peer)
			count++
			if count >= ReplicationFactor {
				break
			}
			continue
		}

		var success bool
		for attempt := 1; attempt <= ReplicateMaxRetries; attempt++ {
			log.Printf("[replicate] sending %s to %s (attempt %d)", filename, peer, attempt)
			if err := postMultipart(peer+"/store-local", "file", filename, userID, data, true); err != nil {
				log.Printf("[replicate] %s FAILED attempt %d: %v", peer, attempt, err)
				time.Sleep(ReplicateRetryDelay * time.Duration(attempt))
				continue
			}
			success = true
			break
		}

		if success {
			storedNodes = append(storedNodes, peer)
			count++
		} else {
			log.Printf("[replicate] giving up on %s after retries", peer)
		}

		if count >= ReplicationFactor {
			break
		}
	}

	if count < ReplicationFactor {
		log.Printf("[replicate] WARNING: file %s under-replicated (%d/%d)", filename, count, ReplicationFactor)
	}
	return storedNodes
}

func postMultipart(url, fieldName, filename, userID string, data []byte, isReplica bool) error {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile(fieldName, filename)
	if err != nil {
		return err
	}
	_, err = io.Copy(part, bytes.NewReader(data))
	if err != nil {
		return err
	}

	_ = w.WriteField("user_id", userID)

	if isReplica {
		_ = w.WriteField("replica", "1")
	}

	w.Close()
	req, err := http.NewRequest(http.MethodPost, url, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("peer %s returned %d: %s", url, resp.StatusCode, string(body))
	}
	return nil
}

func tryProxyFromPeers(c fiber.Ctx, userID, filename, originalFilename string) error {
	peers := strings.Split(getEnv("PEERS", ""), ",")

	log.Printf("[DEBUG PEERS] Trying peers for file: %s", filename)

	for _, peer := range peers {
		peer = strings.TrimSpace(peer)
		if peer == "" {
			continue
		}

		log.Printf("[DEBUG PEERS] Trying peer: %s", peer)

		if !isNodeHealthy(peer) {
			log.Printf("[DEBUG PEERS] Peer %s is unhealthy", peer)
			continue
		}

		client := &http.Client{Timeout: 30 * time.Second}
		proxyURL := fmt.Sprintf("%s/files/raw/%s/%s",
			peer,
			url.PathEscape(userID),
			url.PathEscape(filename))

		log.Printf("[DEBUG PEERS] Proxy URL: %s", proxyURL)

		resp, err := client.Get(proxyURL)
		if err != nil {
			log.Printf("[DEBUG PEERS] Peer %s failed: %v", peer, err)
			continue
		}

		log.Printf("[DEBUG PEERS] Peer %s response status: %d", peer, resp.StatusCode)

		if resp.StatusCode == 200 {
			defer resp.Body.Close()

			c.Set("Content-Type", "application/octet-stream")
			c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", originalFilename))

			bytesWritten, err := io.Copy(c.Response().BodyWriter(), resp.Body)
			if err != nil {
				resp.Body.Close()
				log.Printf("[DEBUG PEERS] Stream from peer %s failed: %v", peer, err)
				continue
			}

			log.Printf("[DEBUG PEERS] Successfully proxied from peer %s, bytes: %d", peer, bytesWritten)
			return nil
		}

		resp.Body.Close()
	}

	log.Printf("[DEBUG PEERS] No peers available")
	return c.Status(404).JSON(fiber.Map{"error": "file not found on any available node"})
}

// -------------------- Auto Sync --------------------

func startAutoSync() {
	go func() {
		time.Sleep(10 * time.Second)

		for {
			log.Printf("[auto-sync] starting synchronization...")
			syncMissingFiles()
			time.Sleep(5 * time.Minute)
		}
	}()
}

var lastSyncState = make(map[string]int)

func deleteFileOnNode(nodeURL, filename string) {
	if nodeURL == selfURL() {
		nodeRoot := filepath.Join(storageRoot(), getEnv("NODE_ID", "s1"))
		users, err := os.ReadDir(nodeRoot)
		if err != nil {
			log.Printf("[sync] failed to list users in %s: %v", nodeRoot, err)
			return
		}

		for _, u := range users {
			if !u.IsDir() {
				continue
			}
			userID := u.Name()
			fileDir := filepath.Join(nodeRoot, userID, filename)
			if _, err := os.Stat(fileDir); os.IsNotExist(err) {
				continue
			}

			if err := deleteFile(getEnv("NODE_ID", "s1"), userID, filename); err != nil {
				log.Printf("[sync] failed to delete %s for user %s: %v", filename, userID, err)
			} else {
				log.Printf("[sync] deleted %s for user %s (over-replicated)", filename, userID)
			}
			return
		}

		log.Printf("[sync] file %s not found on self", filename)
		return
	}

	ctx := context.Background()
	users, err := getUserFilesFromFirebase(ctx, "")
	if err != nil {
		log.Printf("[sync] failed to get users from Firebase: %v", err)
		return
	}

	for _, f := range users {
		if fName, ok := f["fileName"].(string); ok && fName == filename {
			if userID, ok := f["userId"].(string); ok {
				reqURL := fmt.Sprintf("%s/api/files/%s?user_id=%s", nodeURL, url.PathEscape(filename), url.QueryEscape(userID))
				client := &http.Client{Timeout: 5 * time.Second}
				req, err := http.NewRequest("DELETE", reqURL, nil)
				if err != nil {
					log.Printf("[sync] failed to create DELETE request for %s on %s: %v", filename, nodeURL, err)
					continue
				}
				resp, err := client.Do(req)
				if err != nil {
					log.Printf("[sync] failed to delete %s from %s: %v", filename, nodeURL, err)
					continue
				}
				defer resp.Body.Close()

				if resp.StatusCode >= 200 && resp.StatusCode < 300 {
					log.Printf("[sync] deleted %s from %s (over-replicated)", filename, nodeURL)
				} else {
					body, _ := io.ReadAll(resp.Body)
					log.Printf("[sync] failed to delete %s from %s, status: %d, body: %s", filename, nodeURL, resp.StatusCode, string(body))
				}
			}
			break
		}
	}
}

func syncMissingFiles() {
	healthyPeers := getHealthyNodes()
	allNodes := append(peersList(), selfURL())

	peerFiles := make(map[string]map[string][]string)

	for _, node := range allNodes {
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get(node + "/files")
		if err != nil {
			continue
		}
		var data struct {
			Files []struct {
				Name   string `json:"name"`
				UserID string `json:"user_id"`
			} `json:"files"`
		}
		json.NewDecoder(resp.Body).Decode(&data)
		resp.Body.Close()

		for _, f := range data.Files {
			if _, ok := peerFiles[f.Name]; !ok {
				peerFiles[f.Name] = make(map[string][]string)
			}
			peerFiles[f.Name][f.UserID] = append(peerFiles[f.Name][f.UserID], node)
		}
	}

	// --- Limit concurrent replication ---
	maxWorkers := 50
	sem := make(chan struct{}, maxWorkers)
	var wg sync.WaitGroup

	for filename, users := range peerFiles {
		for userID, nodes := range users {

			if len(nodes) < ReplicationFactor {
				wg.Add(1)
				sem <- struct{}{}

				go func(f, u string, nList []string) {
					defer wg.Done()
					defer func() { <-sem }()

					log.Printf("[sync] file %s (user %s) under-replicated (%d/%d), replicating...", f, u, len(nList), ReplicationFactor)
					sourceNode := nList[0]
					data, err := downloadFileFromPeer(u, sourceNode, f)
					if err != nil {
						log.Printf("[sync] failed to download %s from %s: %v", f, sourceNode, err)
						return
					}

					targets := []string{}
					for _, peer := range healthyPeers {
						if !contains(nList, peer) {
							targets = append(targets, peer)
						}
					}
					if len(targets) == 0 && !contains(nList, selfURL()) {
						targets = append(targets, selfURL())
					}

					for _, t := range targets {
						if t == selfURL() {
							writeChunks(u, f, data)
						} else {
							err := postMultipart(t+"/store-local", "file", f, u, data, true)
							if err != nil {
								log.Printf("[sync] failed to replicate %s to %s: %v", f, t, err)
								continue
							}
						}
						nList = append(nList, t)
					}
					log.Printf("[sync] replication of %s (user %s) done, now %d replicas", f, u, len(nList))
					lastSyncState[f] = len(nList)

				}(filename, userID, nodes)
			}

			// --- Over-replicated ---
			if len(nodes) > ReplicationFactor {
				log.Printf("[sync] file %s (user %s) over-replicated (%d/%d), removing extra replicas...", filename, userID, len(nodes), ReplicationFactor)
				sortedNodes := append([]string{}, nodes...)
				sort.Strings(sortedNodes)
				toDelete := sortedNodes[ReplicationFactor:]
				for _, node := range toDelete {
					deleteFileOnNode(node, filename)
				}
			}
		}
	}

	wg.Wait()
}

func contains(arr []string, s string) bool {
	for _, v := range arr {
		if v == s {
			return true
		}
	}
	return false
}

func downloadFileFromPeer(userID, peer, filename string) ([]byte, error) {
	encoded := url.PathEscape(filename)
	url := fmt.Sprintf("%s/files/raw/%s/%s", peer, url.PathEscape(userID), encoded)
	log.Printf("[sync] downloading %s from %s", filename, url)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to get: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("peer returned %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read body: %w", err)
	}

	chunks, err := writeChunks(userID, filename, data)
	if err != nil {
		return nil, fmt.Errorf("failed to write chunks: %w", err)
	}

	log.Printf("[sync] file %s downloaded and written %d chunks", filename, chunks)
	return data, nil
}

// -------------------- File Operations --------------------

func deleteFile(nodeID, userID, filename string) error {
	dir := filepath.Join(storageRoot(), nodeID, userID, filename)
	return os.RemoveAll(dir)
}

func getFileMetadata(nodeID, userID, filename string) (map[string]interface{}, error) {
	dir := filepath.Join(storageRoot(), nodeID, userID, filename)

	if !hasAnyChunk(nodeID, userID, filename) {
		return nil, fmt.Errorf("file not found")
	}

	var totalSize int64
	chunks := 0
	var modTime time.Time

	for i := 0; ; i++ {
		chunkPath := filepath.Join(dir, fmt.Sprintf("%d.chunk", i))
		fi, err := os.Stat(chunkPath)
		if os.IsNotExist(err) {
			break
		}
		if err != nil {
			return nil, err
		}
		totalSize += fi.Size()
		chunks++
		if fi.ModTime().After(modTime) {
			modTime = fi.ModTime()
		}
	}

	return map[string]interface{}{
		"filename":   filename,
		"user_id":    userID,
		"size_bytes": totalSize,
		"size_mb":    fmt.Sprintf("%.2f", float64(totalSize)/1024.0/1024.0),
		"chunks":     chunks,
		"modified":   modTime.Unix(),
		"location":   nodeID,
		"available":  true,
		"path":       dir,
	}, nil
}

func getUserFilesFromFirebase(ctx context.Context, userID string) ([]map[string]interface{}, error) {
	var files []map[string]interface{}
	iter := firestoreClient.Collection("files").Where("userId", "==", userID).Documents(ctx)
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		files = append(files, doc.Data())
	}
	return files, nil
}

// --------------------------  Middle Ware ----------------------------
func firebaseAuthMiddleware(c fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"error": "missing Authorization header"})
	}

	idToken := strings.TrimPrefix(authHeader, "Bearer ")

	decoded, err := firebaseAuth.VerifyIDToken(context.Background(), idToken)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "invalid token"})
	}

	c.Locals("userID", decoded.UID)
	return c.Next()
}

func uploadHandler(c fiber.Ctx) error {
	userIDIface := c.Locals("userID")
	userID, ok := userIDIface.(string)
	if !ok || userID == "" {
		return c.Status(401).JSON(fiber.Map{"error": "unauthorized"})
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "file required"})
	}

	filename := filepath.Base(fileHeader.Filename)
	src, err := fileHeader.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to open file"})
	}
	defer src.Close()

	data, err := io.ReadAll(src)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "failed to read file"})
	}

	targetNode := chooseTargetNode(userID)
	log.Printf("[upload] target node for user %s, file %s: %s", userID, filename, targetNode)

	var storedNodes []string
	var chunks int

	if targetNode == selfURL() {
		chunks, err = writeChunks(userID, filename, data)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		storedNodes = replicateToPeers(userID, filename, data)
		log.Printf("[upload] replication finished: %v", storedNodes)
	} else {
		err := postMultipart(targetNode+"/store-local", "file", filename, userID, data, false)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		storedNodes = []string{targetNode}
	}

	filePath := fmt.Sprintf("%s/%s/%s", selfURL(), userID, filename)

	return c.JSON(fiber.Map{
		"success":    true,
		"filename":   filename,
		"filePath":   filePath,
		"size_bytes": len(data),
		"stored_on":  storedNodes,
		"chunks":     chunks,
		"status":     "stored",
	})
}

// ----------------------  Admin page ---------------------------

func toggleDockerNode(node, action string) error {
	re := regexp.MustCompile(`s\d+`)
	container := re.FindString(node)
	if container == "" {
		return errors.New("invalid node name")
	}

	cmd := exec.Command("docker", action, container)
	out, err := cmd.CombinedOutput()
	fmt.Println("docker", action, container, "=>", string(out))
	return err
}

func getDockerLogs(containerName string) (string, error) {
	cmd := exec.Command("docker", "logs", "--tail", "100", containerName)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// -------------------- Main & API Endpoints --------------------

func main() {
	initFirebase()
	nodeID := getEnv("NODE_ID", "s1")
	if err := ensureDir(filepath.Join(storageRoot(), nodeID)); err != nil {
		log.Fatalf("cannot create node storage: %v", err)
	}

	log.Printf("NODE_ID=%s storage=%s", getEnv("NODE_ID", "s1"), storageRoot())
	log.Printf("SELF_URL=%s", selfURL())
	log.Printf("PEERS=%v", peersList())

	startAutoSync()

	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100MB limit
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: []string{"*"},
		AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
	}))

	// API: Health check
	app.Get("/api/health", func(c fiber.Ctx) error {
		return c.JSON(map[string]interface{}{
			"node":          getEnv("NODE_ID", "s1"),
			"self":          selfURL(),
			"peers":         peersList(),
			"healthy_peers": getHealthyNodes(),
			"status":        "ok",
			"timestamp":     time.Now().Unix(),
		})
	})

	// API: Smart upload
	app.Post("/api/upload", firebaseAuthMiddleware, uploadHandler)

	// Internal: Store local (used by other nodes)
	app.Post("/store-local", func(c fiber.Ctx) error {
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(map[string]interface{}{"error": "file required"})
		}
		src, err := fileHeader.Open()
		if err != nil {
			return c.Status(500).JSON(map[string]interface{}{"error": err.Error()})
		}
		defer src.Close()

		userID := c.FormValue("user_id")
		if userID == "" {
			userIDIface := c.Locals("userID")
			uid, ok := userIDIface.(string)
			if ok && uid != "" {
				userID = uid
			} else {
				userID = getEnv("NODE_ID", "s1")
			}
		}

		filename := filepath.Base(fileHeader.Filename)
		data, err := io.ReadAll(src)
		if err != nil {
			return c.Status(500).JSON(map[string]interface{}{"error": err.Error()})
		}

		chunks, err := writeChunks(userID, filename, data)
		if err != nil {
			return c.Status(500).JSON(map[string]interface{}{"error": err.Error()})
		}

		storedNodes := []string{selfURL()}

		isReplicaRequest := c.FormValue("replica") == "1"
		if !isReplicaRequest {
			storedNodes = replicateToPeers(userID, filename, data)
		} else {
			storedNodes = append(storedNodes, c.IP())
		}

		return c.JSON(map[string]interface{}{
			"success":   true,
			"node":      getEnv("NODE_ID", "s1"),
			"filename":  filename,
			"user_id":   userID,
			"chunks":    chunks,
			"stored_on": storedNodes,
			"status":    "stored locally",
		})
	})

	// API: Download file
	app.Get("/api/files/:filename", firebaseAuthMiddleware, func(c fiber.Ctx) error {
		encoded := c.Params("filename")
		filename, err := url.PathUnescape(encoded)
		if err != nil {
			log.Printf("[download] ERROR: invalid filename encoding: %v", err)
			return c.Status(400).JSON(fiber.Map{"error": "invalid filename"})
		}

		userIDIface := c.Locals("userID")
		userID, ok := userIDIface.(string)
		if !ok || userID == "" {
			log.Printf("[download] ERROR: missing or invalid userID")
			return c.Status(401).JSON(fiber.Map{"error": "unauthorized"})
		}

		log.Printf("[download] START: user=%s, filename=%s", userID, filename)

		fileMeta, err := getFileMetadataFromFirebase(userID, filename)
		if err != nil {
			log.Printf("[download] ERROR: file not found in database: %v", err)
			return c.Status(404).JSON(fiber.Map{"error": "file not found"})
		}

		if len(fileMeta.NodeID) == 0 {
			log.Printf("[download] ERROR: no nodeID in metadata")
			return c.Status(500).JSON(fiber.Map{"error": "no nodeID in metadata"})
		}

		targetNodeRaw := fileMeta.NodeID[0]
		targetNodeID := parseNodeID(targetNodeRaw)
		currentNodeID := parseNodeID(getEnv("NODE_ID", ""))
		fileUserID := fileMeta.UserID
		actualFilename := fileMeta.FileName

		log.Printf("[download] targetNodeID=%s, currentNodeID=%s, fileUserID=%s, actualFilename=%s",
			targetNodeID, currentNodeID, fileUserID, actualFilename)

		// Helper function for min
		min := func(a, b int) int {
			if a < b {
				return a
			}
			return b
		}

		if targetNodeID == currentNodeID {
			if !hasAnyChunk(currentNodeID, fileUserID, actualFilename) {
				log.Printf("[download] ERROR: no chunks found on current node")
				return c.Status(404).JSON(fiber.Map{"error": "file not found on current node"})
			}

			// read buffer
			var buffer bytes.Buffer
			bytesWritten, err := reconstructToWriter(currentNodeID, fileUserID, actualFilename, &buffer)
			if err != nil {
				log.Printf("[download] ERROR: reconstruct failed: %v", err)
				return c.Status(500).JSON(fiber.Map{"error": "failed to read file: " + err.Error()})
			}

			// Auto-detect Content-Type
			bufferBytes := buffer.Bytes()
			detectedType := http.DetectContentType(bufferBytes[:min(512, len(bufferBytes))])

			c.Set("Content-Type", detectedType)
			c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
			c.Set("Cache-Control", "no-cache")

			_, err = io.Copy(c.Response().BodyWriter(), &buffer)
			if err != nil {
				log.Printf("[download] ERROR: failed to write response: %v", err)
				return c.Status(500).JSON(fiber.Map{"error": "failed to write response: " + err.Error()})
			}

			log.Printf("[download] SUCCESS: sent %d bytes with Content-Type: %s", bytesWritten, detectedType)
			return nil
		}

		targetNodeURL := targetNodeRaw
		if !isNodeHealthy(targetNodeURL) {
			log.Printf("[download] Target node %s not healthy, trying peers...", targetNodeURL)
			return tryProxyFromPeers(c, fileUserID, actualFilename, filename)
		}

		proxyURL := fmt.Sprintf("%s/files/raw/%s/%s",
			targetNodeURL, url.PathEscape(fileUserID), url.PathEscape(actualFilename))

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Get(proxyURL)
		if err != nil {
			log.Printf("[download] ERROR: proxy request failed: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to proxy file: " + err.Error()})
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			bodyBytes, _ := io.ReadAll(resp.Body)
			log.Printf("[download] ERROR: target node returned %d: %s", resp.StatusCode, string(bodyBytes))
			return c.Status(resp.StatusCode).JSON(fiber.Map{
				"error": fmt.Sprintf("target node returned %d: %s", resp.StatusCode, string(bodyBytes)),
			})
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("[download] ERROR: failed to read response body: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to read response body: " + err.Error()})
		}

		// Auto-detect Content-Type for proxied file
		detectedType := http.DetectContentType(bodyBytes[:min(512, len(bodyBytes))])
		log.Printf("[download] Auto-detected Content-Type for proxied file: %s", detectedType)

		c.Set("Content-Type", detectedType)
		c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		c.Set("Cache-Control", "no-cache")

		bytesWritten, err := c.Response().BodyWriter().Write(bodyBytes)
		if err != nil {
			log.Printf("[download] ERROR: failed to stream file: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to stream file: " + err.Error()})
		}

		log.Printf("[download] SUCCESS: proxied %d bytes with Content-Type: %s", bytesWritten, detectedType)
		return nil
	})

	// Internal: Raw download (for peer-to-peer)
	app.Get("/files/raw/:userID/:filename", func(c fiber.Ctx) error {
		userID := c.Params("userID")
		filename := c.Params("filename")

		decodedFilename, err := url.PathUnescape(filename)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid filename"})
		}

		currentNodeID := getEnv("NODE_ID", "s1")

		if hasAnyChunk(currentNodeID, userID, decodedFilename) {
			c.Set("Content-Type", "application/octet-stream")

			_, err := reconstructToWriter(currentNodeID, userID, decodedFilename, c.Response().BodyWriter())
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "failed to read file: " + err.Error()})
			}
			return nil
		}

		return c.Status(404).JSON(fiber.Map{"error": "file not found"})
	})

	// API: Delete file
	app.Delete("/api/files/:filename", firebaseAuthMiddleware, func(c fiber.Ctx) error {
		userIDIface := c.Locals("userID")
		userID, ok := userIDIface.(string)
		if !ok || userID == "" {
			userID = c.Query("user_id")
			if userID == "" {
				return c.Status(400).JSON(fiber.Map{"error": "missing user_id"})
			}
		}

		encoded := c.Params("filename")
		filename, err := url.PathUnescape(encoded)
		if err != nil {
			log.Printf("invalid filename: %v", err)
			return c.Status(400).JSON(fiber.Map{"error": "invalid filename"})
		}

		if err := deleteFile(getEnv("NODE_ID", "s1"), userID, filename); err != nil {
			log.Printf("failed to delete local file: %v", err)
		}

		firebaseToken := c.Get("Authorization")
		for _, peer := range peersList() {
			reqURL := fmt.Sprintf("%s/files/raw/%s/%s",
				peer, url.PathEscape(userID), url.PathEscape(filename))
			req, _ := http.NewRequest("DELETE", reqURL, nil)
			if firebaseToken != "" {
				req.Header.Set("Authorization", firebaseToken)
			}
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				log.Printf("peer %s delete failed: %v", peer, err)
				continue
			}
			resp.Body.Close()
			if resp.StatusCode >= 300 {
				log.Printf("peer %s returned status %d", peer, resp.StatusCode)
			}
		}

		if err := deleteFileMetadataFromFirebase(userID, filename); err != nil {
			log.Printf("failed to delete metadata: %v", err)
		}

		return c.JSON(fiber.Map{"success": true})
	})

	// DELETE /files/raw/:userID/:filename
	app.Delete("/files/raw/:userID/:filename", firebaseAuthMiddleware, func(c fiber.Ctx) error {
		userID := c.Params("userID")
		encoded := c.Params("filename")
		filename, err := url.PathUnescape(encoded)
		if err != nil {
			log.Printf("invalid filename: %v", err)
			return c.Status(400).JSON(fiber.Map{"error": "invalid filename"})
		}

		nodeID := getEnv("NODE_ID", "s1")

		if err := deleteFile(nodeID, userID, filename); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(fiber.Map{"success": true, "filename": filename})
	})

	// API: List local files
	app.Get("/api/files", firebaseAuthMiddleware, func(c fiber.Ctx) error {
		userIDIface := c.Locals("userID")
		userID, _ := userIDIface.(string)
		if userID == "" {
			return c.Status(401).JSON(fiber.Map{"error": "unauthorized"})
		}

		ctx := context.Background()
		files, err := getUserFilesFromFirebase(ctx, userID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "error": err.Error()})
		}

		if files == nil {
			files = []map[string]interface{}{}
		}

		return c.JSON(fiber.Map{
			"success": true,
			"user_id": userID,
			"files":   files,
		})
	})

	// Internal: List files (used by peers)
	app.Get("/files", func(c fiber.Ctx) error {
		nodeID := getEnv("NODE_ID", "s1")
		nodeRoot := filepath.Join(storageRoot(), nodeID)

		entries, err := os.ReadDir(nodeRoot)
		if err != nil {
			return c.Status(500).JSON(map[string]interface{}{
				"error": err.Error(),
			})
		}

		files := []map[string]interface{}{}
		for _, userDir := range entries {
			if !userDir.IsDir() {
				continue
			}
			userID := userDir.Name()
			userPath := filepath.Join(nodeRoot, userID)

			fileDirs, err := os.ReadDir(userPath)
			if err != nil {
				continue
			}

			for _, fileDir := range fileDirs {
				if !fileDir.IsDir() {
					continue
				}
				files = append(files, map[string]interface{}{
					"user_id": userID,
					"name":    fileDir.Name(),
				})
			}
		}

		return c.JSON(map[string]interface{}{
			"node":  nodeID,
			"files": files,
		})
	})

	app.Get("/api/files/count", func(c fiber.Ctx) error {
		nodeID := c.Query("node", getEnv("NODE_ID", "s1"))
		nodeRoot := filepath.Join(storageRoot(), nodeID)

		if _, err := os.Stat(nodeRoot); os.IsNotExist(err) {
			return c.Status(404).JSON(map[string]interface{}{
				"error": "node folder not found",
				"node":  nodeID,
			})
		}

		entries, err := os.ReadDir(nodeRoot)
		if err != nil {
			return c.Status(500).JSON(map[string]interface{}{"error": err.Error()})
		}

		fileCount := 0
		for _, userDir := range entries {
			if !userDir.IsDir() {
				continue
			}
			userPath := filepath.Join(nodeRoot, userDir.Name())
			fileDirs, err := os.ReadDir(userPath)
			if err != nil {
				continue
			}
			for _, fileDir := range fileDirs {
				if fileDir.IsDir() {
					fileCount++
				}
			}
		}

		return c.JSON(map[string]interface{}{
			"node":  nodeID,
			"count": fileCount,
		})
	})

	// API: Global file list (from all nodes)
	app.Get("/api/files/global", func(c fiber.Ctx) error {
		type NodeFiles struct {
			Node   string                   `json:"node"`
			Files  []map[string]interface{} `json:"files"`
			Status string                   `json:"status"`
		}

		results := []NodeFiles{}

		localFiles := []map[string]interface{}{}
		nodeID := getEnv("NODE_ID", "s1")
		root := filepath.Join(storageRoot(), nodeID)
		if entries, err := os.ReadDir(root); err == nil {
			for _, userDir := range entries {
				if !userDir.IsDir() {
					continue
				}
				userID := userDir.Name()
				userPath := filepath.Join(root, userID)

				fileDirs, err := os.ReadDir(userPath)
				if err != nil {
					continue
				}

				for _, fileDir := range fileDirs {
					if !fileDir.IsDir() {
						continue
					}
					filename := fileDir.Name()
					if metadata, err := getFileMetadata(nodeID, userID, filename); err == nil {
						localFiles = append(localFiles, metadata)
					}
				}
			}
		}

		results = append(results, NodeFiles{
			Node:   nodeID,
			Files:  localFiles,
			Status: "local",
		})

		for _, peer := range peersList() {
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Get(peer + "/api/files")
			if err != nil {
				results = append(results, NodeFiles{
					Node:   peer,
					Files:  []map[string]interface{}{},
					Status: "unreachable",
				})
				continue
			}
			defer resp.Body.Close()

			if resp.StatusCode == 200 {
				var peerData struct {
					Files []map[string]interface{} `json:"files"`
				}
				if err := json.NewDecoder(resp.Body).Decode(&peerData); err == nil {
					results = append(results, NodeFiles{
						Node:   peer,
						Files:  peerData.Files,
						Status: "healthy",
					})
				}
			}
		}

		return c.JSON(map[string]interface{}{
			"success":       true,
			"nodes":         results,
			"healthy_count": len(getHealthyNodes()) + 1,
			"total_nodes":   len(peersList()) + 1,
			"replication":   ReplicationFactor,
		})
	})

	// API: File info
	app.Get("/api/files/:userID/:filename/info", func(c fiber.Ctx) error {
		userID := c.Params("userID")
		encoded := c.Params("filename")
		filename, err := url.PathUnescape(encoded)
		if err != nil {
			return c.Status(400).JSON(map[string]interface{}{
				"error": "invalid filename",
			})
		}

		nodeID := getEnv("NODE_ID", "s1")

		if hasAnyChunk(nodeID, userID, filename) {
			metadata, err := getFileMetadata(nodeID, userID, filename)
			if err != nil {
				return c.Status(500).JSON(map[string]interface{}{
					"error": err.Error(),
				})
			}
			return c.JSON(map[string]interface{}{
				"success": true,
				"file":    metadata,
			})
		}

		for _, peer := range getHealthyNodes() {
			client := &http.Client{Timeout: 5 * time.Second}
			url := fmt.Sprintf("%s/api/files/%s/%s/info", peer, userID, url.PathEscape(filename))
			resp, err := client.Get(url)
			if err != nil {
				continue
			}
			defer resp.Body.Close()

			if resp.StatusCode == 200 {
				var info map[string]interface{}
				if err := json.NewDecoder(resp.Body).Decode(&info); err == nil {
					return c.JSON(info)
				}
			}
		}

		return c.Status(404).JSON(map[string]interface{}{
			"error": "file not found in cluster",
		})
	})

	// API: Manual sync
	app.Post("/api/sync", func(c fiber.Ctx) error {
		go syncMissingFiles()
		return c.JSON(map[string]interface{}{
			"success": true,
			"status":  "synchronization started",
			"node":    getEnv("NODE_ID", "s1"),
		})
	})

	// API: Cluster status
	app.Get("/api/cluster/status", func(c fiber.Ctx) error {
		healthy := getHealthyNodes()
		all := peersList()

		nodeStatuses := []map[string]interface{}{}
		nodeStatuses = append(nodeStatuses, map[string]interface{}{
			"node":   getEnv("NODE_ID", "s1"),
			"url":    selfURL(),
			"status": "healthy",
			"self":   true,
		})

		for _, peer := range all {
			isHealthy := false
			for _, h := range healthy {
				if h == peer {
					isHealthy = true
					break
				}
			}

			status := "unhealthy"
			if isHealthy {
				status = "healthy"
			}

			nodeStatuses = append(nodeStatuses, map[string]interface{}{
				"node":   peer,
				"url":    peer,
				"status": status,
				"self":   false,
			})
		}

		return c.JSON(map[string]interface{}{
			"success": true,
			"cluster": map[string]interface{}{
				"total_nodes":     len(all) + 1,
				"healthy_nodes":   len(healthy) + 1,
				"unhealthy_nodes": len(all) - len(healthy),
				"replication":     ReplicationFactor,
			},
			"nodes":     nodeStatuses,
			"timestamp": time.Now().Unix(),
		})
	})

	app.Get("/health", func(c fiber.Ctx) error {
		return c.JSON(map[string]interface{}{
			"status": "ok",
		})
	})

	// docker log
	app.Get("/api/cluster/logs", func(c fiber.Ctx) error {
		nodes := peersList()
		nodes = append(nodes, getEnv("NODE_ID", "s1"))

		allLogs := []string{}

		for _, nodeURL := range nodes {
			nodeName := nodeURL
			if strings.HasPrefix(nodeURL, "http") {
				parts := strings.Split(nodeURL, ":")
				nodeName = strings.TrimPrefix(parts[0], "http://")
			}

			logs, err := getDockerLogs(nodeName)
			if err != nil {
				allLogs = append(allLogs, nodeName+": Error fetching logs: "+err.Error())
				continue
			}
			lines := strings.Split(logs, "\n")
			for _, line := range lines {
				allLogs = append(allLogs, nodeName+": "+line)
			}
		}

		return c.JSON(fiber.Map{
			"success":   true,
			"logs":      allLogs,
			"timestamp": time.Now().Unix(),
		})
	})

	app.Post("/api/node/toggle", func(c fiber.Ctx) error {
		body := struct {
			Node   string `json:"node"`
			Action string `json:"action"`
		}{}
		if err := c.Bind().JSON(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request"})
		}

		err := toggleDockerNode(body.Node, body.Action)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		return c.JSON(fiber.Map{
			"success": true,
			"node":    body.Node,
			"action":  body.Action,
		})
	})

	port := getEnv("PORT", "8080")
	log.Printf("Starting Distributed File Storage API on port %s", port)
	log.Printf("API endpoints available at: http://localhost:%s/api/*", port)
	log.Fatal(app.Listen(":" + port))
}
