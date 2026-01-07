import { useState, useEffect } from "react";
import { api } from "../api";
import "./TwoFactorSetup.css";

interface Props {
  email: string;
  onComplete: () => void;
  onCancel: () => void;
}

function TwoFactorSetup({ email, onComplete, onCancel }: Props) {
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSetup();
  }, []);

  const loadSetup = async () => {
    try {
      const response = await api.setup2FA(email);
      setQrCode(response.qrCode);
      setSecret(response.secret);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to setup 2FA");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="two-factor-setup">
        <div className="setup-box">
          <div className="loading">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="two-factor-setup">
        <div className="setup-box">
          <div className="error-message">{error}</div>
          <button className="btn btn-secondary" onClick={onCancel}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="two-factor-setup">
      <div className="setup-box">
        <div className="setup-header">
          <h2>🔐 Two-Factor Authentication Setup</h2>
          <p>Scan the QR code with your authenticator app</p>
        </div>

        <div className="qr-code-container">
          <img src={qrCode} alt="QR Code" className="qr-code" />
        </div>

        <div className="secret-container">
          <p className="secret-label">Or enter this code manually:</p>
          <code className="secret-code">{secret}</code>
        </div>

        <div className="setup-instructions">
          <h3>Instructions:</h3>
          <ol>
            <li>Install an authenticator app (Google Authenticator, Authy, etc.)</li>
            <li>Scan the QR code or enter the code manually</li>
            <li>Click "Continue" to verify your setup</li>
          </ol>
        </div>

        <div className="setup-actions">
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onComplete}>
            Continue to Verification
          </button>
        </div>
      </div>
    </div>
  );
}

export default TwoFactorSetup;


