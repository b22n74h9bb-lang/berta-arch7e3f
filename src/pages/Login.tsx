import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { oauthMessage } from "@contracts/oauth";

function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);
  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);
  return url.toString();
}

function oauthReasonFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("oauth");
}

export default function Login() {
  const notice = oauthMessage(oauthReasonFromLocation());
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {notice ? (
            <p className="text-sm text-muted-foreground text-center" role="status">
              {notice}
            </p>
          ) : null}
          <Button className="w-full" size="lg" onClick={() => {
            window.location.href = getOAuthUrl();
          }}>
            Sign in with Kimi
          </Button>
          <Button className="w-full" size="lg" variant="outline" onClick={() => {
            window.location.href = "/api/oauth/github";
          }}>
            Sign in with GitHub
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
