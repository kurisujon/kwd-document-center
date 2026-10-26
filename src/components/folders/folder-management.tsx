"use client";

import { useEffect, useMemo, useState } from "react";
import { adminCategories } from "@/lib/documents/admin-categories";
import { CreateFolderAction } from "@/components/documents/create-folder-action";
import { HierarchyManagerAction } from "@/components/documents/hierarchy-manager-action";
import type { UploadDestinationSetting } from "@/lib/documents/upload-destination-settings";

export function FolderManagement() {
  const [destinations, setDestinations] = useState<UploadDestinationSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [updatingId, setUpdatingId] = useState<string>();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string }>();
  const [search, setSearch] = useState("");
  const [filterEnabled, setFilterEnabled] = useState<"ALL" | "ENABLED" | "DISABLED">("ALL");
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/folders/upload-settings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = (await response.json()) as { destinations?: UploadDestinationSetting[] };
        if (active) {
          setDestinations(body.destinations ?? []);
          setLoading(false);
          setError(undefined);
        }
      })
      .catch(() => {
        if (active) {
          setError("Unable to load folder upload destinations. Please retry.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshIndex]);

  function reloadSettings() {
    setLoading(true);
    setError(undefined);
    setRefreshIndex((index) => index + 1);
  }

  async function toggleUploadEnabled(destination: UploadDestinationSetting) {
    const nextState = !destination.uploadEnabled;
    setUpdatingId(destination.destinationId);
    setFeedback(undefined);
    try {
      const response = await fetch("/api/admin/folders/upload-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationId: destination.destinationId,
          uploadEnabled: nextState,
        }),
      });
      const body = await response.json() as { destination?: UploadDestinationSetting; error?: { message?: string } };
      if (!response.ok || !body.destination) {
        setFeedback({
          type: "error",
          message: body.error?.message ?? "Failed to update folder upload setting.",
        });
        return;
      }
      setDestinations((current) =>
        current.map((item) =>
          item.destinationId === destination.destinationId ? body.destination! : item
        )
      );
      setFeedback({
        type: "success",
        message: `Uploads are now ${nextState ? "enabled" : "disabled"} for "${destination.displayName}".`,
      });
    } catch {
      setFeedback({ type: "error", message: "Network error updating folder setting. Please retry." });
    } finally {
      setUpdatingId(undefined);
    }
  }

  const displayedDestinations = useMemo(() => {
    return destinations.filter((item) => {
      if (filterEnabled === "ENABLED" && !item.uploadEnabled) return false;
      if (filterEnabled === "DISABLED" && item.uploadEnabled) return false;
      if (search.trim()) {
        const query = search.toLowerCase().trim();
        return (
          item.displayName.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query) ||
          (item.subcategory && item.subcategory.toLowerCase().includes(query)) ||
          item.filingYear.toString().includes(query)
        );
      }
      return true;
    });
  }, [destinations, filterEnabled, search]);

  const enabledCount = destinations.filter((item) => item.uploadEnabled).length;

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Folder & Destination Manager</h1>
          <p>
            Configure folder hierarchy and curate destination folders enabled for batch and folder document uploads.
          </p>
        </div>
        <div className="document-page-actions">
          <CreateFolderAction categories={adminCategories} />
          <HierarchyManagerAction />
        </div>
      </header>

      <section className="access-note">
        <strong>Upload Destinations:</strong>
        <span>
          Only folders marked as <strong>Upload enabled</strong> will appear as valid destinations in the Folder Upload Center.
        </span>
      </section>

      {feedback && (
        <div
          className={feedback.type === "error" ? "form-error users-feedback" : "form-success users-feedback"}
          role={feedback.type === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </div>
      )}

      {loading ? (
        <section className="users-state" role="status" aria-live="polite">
          Loading folder upload settings…
        </section>
      ) : error ? (
        <section className="users-state users-state-error" role="alert">
          <h2>Folders unavailable</h2>
          <p>{error}</p>
          <button className="button button-secondary" type="button" onClick={reloadSettings}>
            Retry
          </button>
        </section>
      ) : (
        <>
          <div className="users-filter-bar">
            <input
              type="search"
              aria-label="Search destinations"
              placeholder="Search by year, category, or folder name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="table-search-input"
            />
            <select
              aria-label="Filter by upload status"
              value={filterEnabled}
              onChange={(event) => setFilterEnabled(event.target.value as "ALL" | "ENABLED" | "DISABLED")}
              className="table-filter-select"
            >
              <option value="ALL">All folders ({destinations.length})</option>
              <option value="ENABLED">Upload enabled ({enabledCount})</option>
              <option value="DISABLED">Upload disabled ({destinations.length - enabledCount})</option>
            </select>
            {(search || filterEnabled !== "ALL") && (
              <button
                type="button"
                className="clear-filter"
                onClick={() => {
                  setSearch("");
                  setFilterEnabled("ALL");
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          <section className="table-wrap users-table-wrap" aria-label="Upload destinations">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Destination path</th>
                  <th>Kind</th>
                  <th>Year</th>
                  <th>Upload status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedDestinations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      <strong>No folders found.</strong>
                      <span>
                        {destinations.length === 0
                          ? "Use 'Create folder' or 'Manage hierarchy' above to register folders."
                          : "Try adjusting your search or status filter."}
                      </span>
                    </td>
                  </tr>
                ) : (
                  displayedDestinations.map((item) => {
                    const isUpdating = updatingId === item.destinationId;
                    return (
                      <tr key={item.destinationId}>
                        <td>
                          <span className="user-name">{item.displayName}</span>
                        </td>
                        <td>
                          <span className="type-label">{item.hierarchyKind}</span>
                        </td>
                        <td className="nowrap-cell">{item.filingYear}</td>
                        <td>
                          <span className={`status-badge ${item.uploadEnabled ? "status-active" : "status-inactive"}`}>
                            {item.uploadEnabled ? "Upload enabled" : "Disabled"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="button button-secondary table-button"
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void toggleUploadEnabled(item)}
                          >
                            {isUpdating ? "Updating…" : item.uploadEnabled ? "Disable upload" : "Enable upload"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
