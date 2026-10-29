"use client";

import Link from "next/link";
import { useState } from "react";
import type { ApprovalTaskRecord } from "@/lib/documents/types";

interface TasksViewProps {
  initialTasks: ApprovalTaskRecord[];
  userRole: "VIEWER" | "STAFF" | "ADMIN";
}

export function TasksView({ initialTasks, userRole }: TasksViewProps) {
  const tasks = initialTasks;
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const filteredTasks = tasks.filter((t) => {
    const matchesSearch =
      searchTerm === "" ||
      t.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.document_number && t.document_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
      t.step_title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "" || t.document_type === typeFilter;
    return matchesSearch && matchesType;
  });

  const uniqueTypes = Array.from(new Set(tasks.map((t) => t.document_type))).sort();

  return (
    <section className="tasks-container" aria-label="My approval tasks">
      <Link className="back-link" href="/documents">
        ← Back to documents
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Workflow & Governance</p>
          <h1>My Tasks</h1>
          <p>Official records awaiting your review, administrative sign-off, or certification.</p>
        </div>
      </header>

      {userRole === "VIEWER" ? (
        <section className="results-section">
          <p className="file-unavailable">
            Viewer accounts do not have approval or signing authority. This queue is for Staff and Administrative officers.
          </p>
        </section>
      ) : (
        <section className="results-section" aria-labelledby="tasks-title">
          <div className="results-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <p className="eyebrow">Actionable queue</p>
              <h2 id="tasks-title">Pending Sign-offs ({filteredTasks.length})</h2>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <input
                type="search"
                className="input"
                placeholder="Search subject or number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ minWidth: "220px" }}
              />
              <select
                className="input"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All Document Types</option>
                {uniqueTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredTasks.length === 0 ? (
            <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "6px", padding: "2rem", textAlign: "center", marginTop: "1rem" }}>
              <p style={{ margin: "0 0 0.5rem 0", fontWeight: 600, fontSize: "1.1rem" }}>
                All caught up!
              </p>
              <p style={{ margin: 0, color: "#6b7280", fontSize: "0.9rem" }}>
                {tasks.length === 0
                  ? "You have no pending documents awaiting approval or certification."
                  : "No pending tasks match your search or filter criteria."}
              </p>
            </div>
          ) : (
            <div className="table-wrap" style={{ marginTop: "1rem" }}>
              <table>
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Type</th>
                    <th>Subject</th>
                    <th>Current Stage</th>
                    <th>Required Role</th>
                    <th>Date Queued</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task) => (
                    <tr key={task.step_id}>
                      <td>
                        <strong>{task.document_number || "—"}</strong>
                      </td>
                      <td>
                        <span className="type-label">{task.document_type}</span>
                      </td>
                      <td>
                        <Link className="table-action" href={`/documents/${task.document_id}`}>
                          {task.subject}
                        </Link>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>Stage {task.step_number}:</span> {task.step_title}
                      </td>
                      <td>
                        <span className="type-label" style={{ backgroundColor: "#eff6ff", color: "#1e40af" }}>
                          {task.approver_role}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {new Date(task.created_at).toLocaleDateString()}
                      </td>
                      <td>
                        <Link
                          className="button button-primary"
                          href={`/documents/${task.document_id}`}
                          style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem", textDecoration: "none" }}
                        >
                          Review & Sign off →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
