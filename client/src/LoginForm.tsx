import { useState } from "react";
import { useAuth } from "./Auth";

export function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, displayName.trim() || undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: 360,
        margin: "40px auto",
        padding: 24,
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: "1.25rem" }}>
        {mode === "login" ? "Sign in" : "Create account"}
      </h2>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 20 }}>
        Use your own account so you can share the app with someone who has a different goal.
      </p>
      <form onSubmit={handleSubmit}>
        {error && (
          <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 12 }}>{error}</p>
        )}
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: "10px 12px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
            }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={6}
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: "10px 12px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
            }}
          />
        </label>
        {mode === "register" && (
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Display name (optional)</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alex"
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: "10px 12px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
              }}
            />
          </label>
        )}
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            padding: "10px 20px",
            background: "var(--green)",
            border: "none",
            borderRadius: 6,
            color: "var(--bg)",
            fontWeight: 600,
            cursor: submitting ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: 14, color: "var(--text-secondary)" }}>
        {mode === "login" ? (
          <>
            No account?{" "}
            <button
              type="button"
              onClick={() => { setMode("register"); setError(null); }}
              style={{
                background: "none",
                border: "none",
                color: "var(--green)",
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              Create one
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => { setMode("login"); setError(null); }}
              style={{
                background: "none",
                border: "none",
                color: "var(--green)",
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}
