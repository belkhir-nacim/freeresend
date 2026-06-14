"use client";

import React, { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface Domain {
  id: string;
  domain: string;
  status: "pending" | "verified" | "failed";
  dns_records: Array<{
    type: string;
    name: string;
    value: string;
    ttl?: number;
    description?: string;
  }>;
  smtp_credentials?: {
    username: string;
    password: string;
    server: string;
    port: number;
  };
  smtp_config?: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
  };
  created_at: string;
}

export default function DomainsTab() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingDomain, setAddingDomain] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [showDNSModal, setShowDNSModal] = useState<Domain | null>(null);
  const [syncingToDO, setSyncingToDO] = useState(false);
  const [showSmtpModal, setShowSmtpModal] = useState<Domain | null>(null);
  const [generatingSmtp, setGeneratingSmtp] = useState(false);
  const [deletingSmtp, setDeletingSmtp] = useState(false);
  const [provider, setProvider] = useState<"ses" | "smtp">("ses");
  const [showRelayModal, setShowRelayModal] = useState<Domain | null>(null);
  const [savingRelay, setSavingRelay] = useState(false);
  const [relayForm, setRelayForm] = useState({
    host: "",
    port: 587,
    secure: false,
    username: "",
    password: "",
  });

  useEffect(() => {
    loadDomains();
    api
      .getHealth()
      .then((h) => setProvider(h.emailProvider === "smtp" ? "smtp" : "ses"))
      .catch(() => {});
  }, []);

  const loadDomains = async () => {
    try {
      const response = await api.getDomains();
      setDomains(response.data.domains);
    } catch (error) {
      console.error("Failed to load domains:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain.trim()) return;

    setAddingDomain(true);
    try {
      const response = await api.addDomain(newDomain.trim());
      setDomains([response.data.domain, ...domains]);
      setNewDomain("");
      // SMTP mode: domain is auto-verified — go straight to relay config.
      if (provider === "smtp") {
        openRelayModal(response.data.domain);
      } else {
        setShowDNSModal(response.data.domain);
      }
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      alert(errorObj.message || "Failed to add domain");
    } finally {
      setAddingDomain(false);
    }
  };

  const handleVerifyDomain = async (domainId: string) => {
    try {
      const response = await api.verifyDomain(domainId);
      await loadDomains(); // Refresh domains list
      alert(response.message);
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      alert(errorObj.message || "Failed to verify domain");
    }
  };

  const handleDeleteDomain = async (domainId: string) => {
    if (!confirm("Are you sure you want to delete this domain?")) return;

    try {
      await api.deleteDomain(domainId);
      setDomains(domains.filter((d) => d.id !== domainId));
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      alert(errorObj.message || "Failed to delete domain");
    }
  };

  const handleSyncToDigitalOcean = async (domainId: string) => {
    if (
      !confirm(
        "This will create DNS records in your DigitalOcean account. Continue?"
      )
    )
      return;

    setSyncingToDO(true);
    try {
      const response = await api.retryDigitalOceanDNS(domainId);
      alert(`Success: ${response.message}`);
      // Optionally refresh domains to show updated status
      await loadDomains();
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      alert(
        `Failed to sync to DigitalOcean: ${errorObj.message || "Unknown error"}`
      );
    } finally {
      setSyncingToDO(false);
    }
  };

  const handleGenerateSmtp = async (domainId: string) => {
    setGeneratingSmtp(true);
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`/api/domains/${domainId}/smtp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate SMTP credentials");
      }

      await loadDomains();
      const updatedDomain = domains.find((d) => d.id === domainId);
      if (updatedDomain) {
        setShowSmtpModal({ ...updatedDomain, smtp_credentials: data.credentials });
      }
      alert("SMTP credentials generated successfully!");
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      alert(errorObj.message || "Failed to generate SMTP credentials");
    } finally {
      setGeneratingSmtp(false);
    }
  };

  const handleDeleteSmtp = async (domainId: string) => {
    if (!confirm("Are you sure you want to delete these SMTP credentials? This will remove the IAM user from AWS.")) return;

    setDeletingSmtp(true);
    try {
      const token = localStorage.getItem("auth_token");
      const response = await fetch(`/api/domains/${domainId}/smtp`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete SMTP credentials");
      }

      await loadDomains();
      setShowSmtpModal(null);
      alert("SMTP credentials deleted successfully!");
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      alert(errorObj.message || "Failed to delete SMTP credentials");
    } finally {
      setDeletingSmtp(false);
    }
  };

  const openRelayModal = (domain: Domain) => {
    setRelayForm({
      host: domain.smtp_config?.host || "",
      port: domain.smtp_config?.port || 587,
      secure: domain.smtp_config?.secure || false,
      username: domain.smtp_config?.username || "",
      password: "",
    });
    setShowRelayModal(domain);
  };

  const handleSaveRelay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showRelayModal) return;

    setSavingRelay(true);
    try {
      await api.saveDomainSmtpConfig(showRelayModal.id, {
        host: relayForm.host.trim(),
        port: Number(relayForm.port),
        secure: relayForm.secure,
        username: relayForm.username.trim(),
        password: relayForm.password,
      });
      await loadDomains();
      setShowRelayModal(null);
      alert("SMTP relay saved and connection verified.");
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      alert(errorObj.message || "Failed to save SMTP relay");
    } finally {
      setSavingRelay(false);
    }
  };

  const handleRemoveRelay = async (domainId: string) => {
    if (
      !confirm(
        "Remove the SMTP relay for this domain? Sending will stop until it is reconfigured."
      )
    )
      return;

    setSavingRelay(true);
    try {
      await api.deleteDomainSmtpConfig(domainId);
      await loadDomains();
      setShowRelayModal(null);
      alert("SMTP relay removed.");
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      alert(errorObj.message || "Failed to remove SMTP relay");
    } finally {
      setSavingRelay(false);
    }
  };

  const getStatusBadge = (status: Domain["status"]) => {
    const colors = {
      pending: "bg-yellow-100 text-yellow-800",
      verified: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
    };

    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status]}`}
      >
        {status}
      </span>
    );
  };

  if (loading) {
    return <div className="text-center py-8">Loading domains...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-xl font-semibold text-gray-900">Domains</h1>
          <p className="mt-2 text-sm text-gray-700">
            Add and manage your email domains. Domains must be verified before
            you can send emails.
          </p>
        </div>
      </div>

      {/* Add Domain Form */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg leading-6 font-medium text-gray-900">
            Add New Domain
          </h3>
          <div className="mt-2 max-w-xl text-sm text-gray-500">
            <p>Enter a domain you want to use for sending emails.</p>
          </div>
          <form
            onSubmit={handleAddDomain}
            className="mt-5 sm:flex sm:items-center"
          >
            <div className="w-full sm:max-w-xs">
              <input
                type="text"
                placeholder="example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                disabled={addingDomain}
              />
            </div>
            <button
              type="submit"
              disabled={addingDomain || !newDomain.trim()}
              className="mt-3 w-full inline-flex items-center justify-center px-4 py-2 border border-transparent shadow-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addingDomain ? "Adding..." : "Add Domain"}
            </button>
          </form>
        </div>
      </div>

      {/* Domains List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {domains.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No domains added yet. Add your first domain to get started.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {domains.map((domain) => (
              <li key={domain.id}>
                <div className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        {getStatusBadge(domain.status)}
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {domain.domain}
                        </div>
                        <div className="text-sm text-gray-500">
                          Added{" "}
                          {new Date(domain.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {provider === "smtp" ? (
                        <button
                          onClick={() => openRelayModal(domain)}
                          className="text-purple-600 hover:text-purple-900 text-sm font-medium"
                        >
                          {domain.smtp_config
                            ? "Edit SMTP Relay"
                            : "Configure SMTP Relay"}
                        </button>
                      ) : (
                        <>
                          {domain.status === "pending" && (
                            <>
                              <button
                                onClick={() => setShowDNSModal(domain)}
                                className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                              >
                                View DNS Records
                              </button>
                              <button
                                onClick={() => handleVerifyDomain(domain.id)}
                                className="text-green-600 hover:text-green-900 text-sm font-medium"
                              >
                                Check Verification
                              </button>
                            </>
                          )}
                          {domain.status === "verified" && (
                            <>
                              {domain.smtp_credentials ? (
                                <button
                                  onClick={() => setShowSmtpModal(domain)}
                                  className="text-purple-600 hover:text-purple-900 text-sm font-medium"
                                >
                                  View SMTP
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleGenerateSmtp(domain.id)}
                                  disabled={generatingSmtp}
                                  className="text-purple-600 hover:text-purple-900 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {generatingSmtp
                                    ? "Generating..."
                                    : "Generate SMTP"}
                                </button>
                              )}
                            </>
                          )}
                        </>
                      )}
                      <button
                        onClick={() => handleDeleteDomain(domain.id)}
                        className="text-red-600 hover:text-red-900 text-sm font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* DNS Records Modal */}
      {showDNSModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-2xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                DNS Records for {showDNSModal.domain}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Add these DNS records to your domain provider to verify
                ownership and enable email sending:
              </p>

              <div className="space-y-4">
                {showDNSModal.dns_records?.map(
                  (
                    record: {
                      type: string;
                      name: string;
                      value: string;
                      ttl?: number;
                      description?: string;
                    },
                    index: number
                  ) => (
                    <div key={index} className="bg-gray-50 p-4 rounded-lg">
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="font-medium text-gray-700">
                            Type:
                          </span>
                          <div className="mt-1">{record.type}</div>
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">
                            Name:
                          </span>
                          <div className="mt-1 break-all">{record.name}</div>
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">
                            Value:
                          </span>
                          <div className="mt-1 break-all font-mono text-xs bg-white p-2 rounded border">
                            {record.value}
                          </div>
                        </div>
                      </div>
                      {record.description && (
                        <div className="mt-2 text-xs text-gray-500">
                          {record.description}
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => setShowDNSModal(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Close
                </button>
                <button
                  onClick={() => handleSyncToDigitalOcean(showDNSModal.id)}
                  disabled={syncingToDO}
                  className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                >
                  {syncingToDO ? "Syncing..." : "Sync to DigitalOcean"}
                </button>
                <button
                  onClick={() => {
                    handleVerifyDomain(showDNSModal.id);
                    setShowDNSModal(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                >
                  Check Verification
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SMTP Credentials Modal */}
      {showSmtpModal && showSmtpModal.smtp_credentials && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-2xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                SMTP Credentials for {showSmtpModal.domain}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Use these credentials to send emails via SMTP:
              </p>

              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Server:</span>
                      <div className="mt-1 font-mono text-xs bg-white p-2 rounded border">
                        {showSmtpModal.smtp_credentials.server}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Port:</span>
                      <div className="mt-1 font-mono text-xs bg-white p-2 rounded border">
                        {showSmtpModal.smtp_credentials.port}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="space-y-4">
                    <div>
                      <span className="font-medium text-gray-700">Username:</span>
                      <div className="mt-1 font-mono text-xs bg-white p-2 rounded border break-all">
                        {showSmtpModal.smtp_credentials.username}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Password:</span>
                      <div className="mt-1 font-mono text-xs bg-white p-2 rounded border break-all">
                        {showSmtpModal.smtp_credentials.password}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                  <p className="text-xs text-yellow-800">
                    <strong>⚠️ Important:</strong> Store these credentials securely. The password cannot be retrieved again once you close this dialog.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => handleDeleteSmtp(showSmtpModal.id)}
                  disabled={deletingSmtp}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                >
                  {deletingSmtp ? "Deleting..." : "Delete Credentials"}
                </button>
                <button
                  onClick={() => setShowSmtpModal(null)}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SMTP Relay Modal (EMAIL_PROVIDER=smtp) */}
      {showRelayModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-2xl shadow-lg rounded-md bg-white">
            <form onSubmit={handleSaveRelay} className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                SMTP Relay for {showRelayModal.domain}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Email from this domain is sent through this SMTP server. The
                connection is tested before saving.
              </p>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Host
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="smtp.example.com"
                      value={relayForm.host}
                      onChange={(e) =>
                        setRelayForm({ ...relayForm, host: e.target.value })
                      }
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Port
                    </label>
                    <input
                      type="number"
                      required
                      value={relayForm.port}
                      onChange={(e) =>
                        setRelayForm({
                          ...relayForm,
                          port: Number(e.target.value),
                        })
                      }
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Username
                  </label>
                  <input
                    type="text"
                    required
                    value={relayForm.username}
                    onChange={(e) =>
                      setRelayForm({ ...relayForm, username: e.target.value })
                    }
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Password
                    {showRelayModal.smtp_config ? " (re-enter to update)" : ""}
                  </label>
                  <input
                    type="password"
                    required
                    placeholder={
                      showRelayModal.smtp_config ? "Enter to update" : ""
                    }
                    value={relayForm.password}
                    onChange={(e) =>
                      setRelayForm({ ...relayForm, password: e.target.value })
                    }
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    id="relay-secure"
                    type="checkbox"
                    checked={relayForm.secure}
                    onChange={(e) =>
                      setRelayForm({ ...relayForm, secure: e.target.checked })
                    }
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                  />
                  <label
                    htmlFor="relay-secure"
                    className="ml-2 block text-sm text-gray-700"
                  >
                    Use implicit TLS (port 465). Leave off for STARTTLS (587/25).
                  </label>
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                {showRelayModal.smtp_config && (
                  <button
                    type="button"
                    onClick={() => handleRemoveRelay(showRelayModal.id)}
                    disabled={savingRelay}
                    className="mr-auto px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowRelayModal(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRelay}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                >
                  {savingRelay ? "Testing..." : "Test & Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
