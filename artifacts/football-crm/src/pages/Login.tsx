import { useState } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const logoSrc = `${import.meta.env.BASE_URL}bg-logo.png`.replace(/\/\//g, "/");

export default function Login() {
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <InputGroup>
              <InputGroupInput
                type={showPassword ? "text" : "password"}
                autoFocus
                placeholder="Password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(false);
                }}
                data-testid="input-login-password"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                  data-testid="button-toggle-password-visibility"
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
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
