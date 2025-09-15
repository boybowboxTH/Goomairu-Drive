import React, { useEffect, useState } from "react";
import '../../styles/AdminDashboard.css'
import { CheckHealth_FILE_URL, LOG_FILE_URL, TOGGLE_FILE_URL } from '../../api/api'; 
import { db } from '../../firebase'; 

const AdminDashboard = () => {
  const [cluster, setCluster] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [userCount, setUserCount] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [folderCount, setFolderCount] = useState(0);
  const [logs, setLogs] = useState({});

  useEffect(() => {
    const loadCluster = async () => {
      try {
        const res = await fetch(`${CheckHealth_FILE_URL}`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        setLogs(data.logs || []);

        setCluster(data.cluster);
        setNodes(data.nodes || []);
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch cluster status:", err);
        setLoading(false);
      }
    };
    loadCluster();
  }, []);

  useEffect(() => {
    const loadCounts = async () => {
      try {
        const usersSnap = await db.collection('users').get();
        setUserCount(usersSnap.size);

        const foldersSnap = await db.collection('folders').get();
        setFolderCount(foldersSnap.size);

        const filesSnap = await db.collection('files').get();
        setFileCount(filesSnap.size);
      } catch (err) {
        console.error("Failed to fetch counts from Firebase:", err);
      }
    };
    loadCounts();
  }, []);

    useEffect(() => {
    const loadLogs = async () => {
        try {
        const res = await fetch(`${LOG_FILE_URL}`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        setLogs(data.logs || {});
        } catch (err) {
        console.error("Failed to fetch logs:", err);
        }
    };

    loadLogs();
    const interval = setInterval(loadLogs, 180000); // refresh  3 m
    return () => clearInterval(interval);
    }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (!cluster) return <div className="loading text-red">No cluster data</div>;

  const healthy = cluster.healthy_nodes;
  const unhealthy = cluster.unhealthy_nodes;
  const total = healthy + unhealthy;
  const healthyPercent = total > 0 ? ((healthy / total) * 100).toFixed(0) : 0;
  const unhealthyPercent = total > 0 ? ((unhealthy / total) * 100).toFixed(0) : 0;

  const toggleNode = async (node, action) => {
    try {
      const res = await fetch(`${TOGGLE_FILE_URL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, action }),
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      alert(`Node ${node} ${action} success`);
      const clusterRes = await fetch(`${CheckHealth_FILE_URL}`);
      const clusterData = await clusterRes.json();
      setCluster(clusterData.cluster);
      setNodes(clusterData.nodes || []);
    } catch (err) {
      console.error("Failed to toggle node:", err);
      alert("Failed to toggle node");
    }
  };

  return (
    <div className="admin-dashboard">
      <h1 className="dashboard-title">Admin Dashboard</h1>

      <div className="card-container">
        <div className="card"><h2>Total Nodes</h2><p>{cluster.total_nodes}</p></div>
        <div className="card"><h2>Replication Factor</h2><p>{cluster.replication}</p></div>
        <div className="card"><h2>Healthy Nodes</h2><p className="text-green">{cluster.healthy_nodes}</p></div>
        <div className="card"><h2>Total Users</h2><p>{userCount}</p></div>
        <div className="card"><h2>Total Folders</h2><p>{folderCount}</p></div>
        <div className="card"><h2>Total Files</h2><p>{fileCount}</p></div>
      </div>

      <div className="chart-container">
        <div className="chart-circle">
          <div className="healthy-bar" style={{ width: `${healthyPercent}%` }}></div>
          <div className="unhealthy-bar" style={{ width: `${unhealthyPercent}%` }}></div>
          <div className="chart-label">
            <div>{healthyPercent}% Healthy</div>
            <div>{unhealthyPercent}% Unhealthy</div>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr><th>Node</th><th>URL</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {nodes.map((n, i) => (
              <tr key={i}>
                <td>{n.node}</td>
                <td>{n.url}</td>
                <td><span className={n.status === "healthy" ? "status-healthy" : "status-unhealthy"}>{n.status}</span></td>
                <td>
                  <button
                    onClick={() => {
                        const nodeName = n.node.match(/s\d+/)?.[0]; 
                        if (!nodeName) {
                        alert("Invalid node name");
                        return;
                        }
                        toggleNode(nodeName, n.status === "healthy" ? "stop" : "start");
                    }}
                    >
                    {n.status === "healthy" ? "Disable" : "Enable"}
                    </button>

                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="logs-container">
        <h2>Cluster Logs</h2>
        <pre>
            {logs.join("\n")}
        </pre>
      </div>
    </div>
  );
};

export default AdminDashboard;
