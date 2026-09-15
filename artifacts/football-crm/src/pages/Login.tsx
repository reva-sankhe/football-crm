import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const logoSrc = `${import.meta.env.BASE_URL}bg-logo.png`.replace(/\/\//g, "/");

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (login(password)) {
      navigate("/players");
    } else {
      setError(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src={logoSrc} alt="Bombay Gymkhana · Women's Football" className="w-14 h-14 object-contain mb-1" />
          <CardTitle>Bombay Gymkhana</CardTitle>
          <CardDescription>Enter the shared password to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              type="password"
              autoFocus
              placeholder="Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(false);
              }}
              data-testid="input-login-password"
            />
            {error && (
              <p className="text-sm text-destructive" data-testid="text-login-error">
                Incorrect password
              </p>
            )}
            <Button type="submit" className="w-full" data-testid="button-login-submit">
              Log in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
