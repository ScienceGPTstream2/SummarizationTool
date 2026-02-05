import { useState } from "react";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Input } from "./ui/input";
import { Alert } from "./ui/alert";

interface LoginPageProps {
  onLogin: (token: string) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    const endpoint = mode === "login" ? "/api/login" : "/api/register";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || result.message || "Error");
      }
      const token = mode === "login" ? result.token : null;
      if (mode === "login" && token) {
        onLogin(token);
      } else if (mode === "register") {
        // After registration, switch to login mode
        setMode("login");
        setError("Registered successfully. Please log in.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">
            {mode === "login" ? "Login" : "Register"}
          </CardTitle>
          <CardDescription className="text-center">
            {mode === "login"
              ? "Sign in to access the app"
              : "Create a new account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="space-y-2">
            <label className="block text-sm font-medium">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading
              ? mode === "login"
                ? "Logging in..."
                : "Registering..."
              : mode === "login"
                ? "Login"
                : "Register"}
          </Button>
          <div className="text-center">
            {mode === "login" ? (
              <p className="text-sm">
                New user?{" "}
                <button
                  className="text-primary hover:underline"
                  onClick={() => {
                    setMode("register");
                    setError(null);
                  }}
                >
                  Register here
                </button>
              </p>
            ) : (
              <p className="text-sm">
                Already have an account?{" "}
                <button
                  className="text-primary hover:underline"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                >
                  Login here
                </button>
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
