import { discordCookie, githubCookie } from "../jwt";
import { generateDiscordOauthUrl } from "../shared";

export async function index(request: Request) {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("force") !== "true" && await discordCookie.get(request) && await githubCookie.get(request)) {
        return new Response(null, {
            status: 302,
            headers: {
                Location: "/connection"
            }
        });
    }

    const { host } = new URL(request.url);
    const url = generateDiscordOauthUrl(host);

    const headers = new Headers();
    headers.set("Location", url);
    headers.append("Set-Cookie", "discord=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    headers.append("Set-Cookie", "github=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");

    return new Response(null, {
        status: 302,
        headers
    });
}