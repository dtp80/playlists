import { useState } from "react";
import { api } from "../api";
import { AuthResponse, User } from "../types";
import TwoFactorSetup from "./TwoFactorSetup";
import TwoFactorVerify from "./TwoFactorVerify";
import "./Login.css";

interface Props {
  onLoginSuccess: (user: User) => void;
}

type AuthStep = "login" | "2fa-setup" | "2fa-verify";

function Login({ onLoginSuccess }: Props) {
  const [step, setStep] = useState<AuthStep>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response: AuthResponse = await api.login({ email, password });

      if (response.requires2FASetup) {
        setStep("2fa-setup");
      } else if (response.requiresTwoFactor) {
        setStep("2fa-verify");
      } else if (response.user) {
        onLoginSuccess(response.user);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handle2FASetupComplete = () => {
    setStep("2fa-verify");
  };

  const handle2FAVerifySuccess = (user: User) => {
    onLoginSuccess(user);
  };

  if (step === "2fa-setup") {
    return (
      <TwoFactorSetup
        email={email}
        onComplete={handle2FASetupComplete}
        onCancel={() => {
          setStep("login");
          setError("");
        }}
      />
    );
  }

  if (step === "2fa-verify") {
    return (
      <TwoFactorVerify
        onSuccess={handle2FAVerifySuccess}
        onCancel={() => {
          setStep("login");
          setError("");
        }}
      />
    );
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <h1>🎬 IPTV Manager</h1>
          <p>Sign in to your account</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div className="login-footer">
            <span className="login-help-text">
              Contact your administrator for access
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Login;
