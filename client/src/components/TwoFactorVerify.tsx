import { useState } from "react";
import { api } from "../api";
import { User } from "../types";
import "./TwoFactorVerify.css";

interface Props {
  onSuccess: (user: User) => void;
  onCancel: () => void;
}

function TwoFactorVerify({ onSuccess, onCancel }: Props) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await api.verify2FA(token);
      if (response.user) {
        onSuccess(response.user);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Verification failed");
      setToken(""); // Clear token on error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="two-factor-verify">
      <div className="verify-box">
        <div className="verify-header">
          <h2>🔐 Two-Factor Authentication</h2>
          <p>Enter the code from your authenticator app</p>
        </div>

        {error && <div className="verify-error">{error}</div>}

        <form onSubmit={handleSubmit} className="verify-form">
          <div className="form-group">
            <label htmlFor="token">Authentication Code</label>
            <input
              type="text"
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
              placeholder="Enter 6-digit code"
              maxLength={6}
              required
              autoFocus
              className="token-input"
            />
          </div>

          <div className="verify-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || token.length !== 6}
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TwoFactorVerify;


