import type { RESTError, RESTGetAPIGuildMemberResult, RESTGetAPIUserResult, RESTPostOAuth2AccessTokenResult, RESTPutAPIGuildMemberJSONBody, RESTPutAPIGuildMemberResult } from "discord-api-types/v10";
import { Routes } from "discord-api-types/v10";

import { REST } from "../../discord/rest";
import { discordCookie } from "../../jwt";
import { discord, err, generateGithubOauthUrl, getRedirectUri } from "../../shared";

export async function loginDiscord(request: Request, env: Env) {
    const { host, searchParams } = new URL(request.url);

    const code = searchParams.get("code");
    if (!code) return err(request, "Invalid code");

    const access = await exchangeToken(env, host, code);
    if ("error_description" in access) return err(request, access.error_description);

    const rest = new REST({ version: "10", authPrefix: "Bearer" }).setToken(access.access_token);

    const { user, member } = await getUserAndMember(rest, env);
    if (!user || "message" in user) return err(request, "Invalid user");

    if (!member || "message" in member) {
        try {
            const added = await addMemberToServer(user.id, access.access_token, env);
            if (added && "message" in added) throw new Error(added.message);
        } catch {
            return err(request, `You must be a member of the ${env.GITHUB_OWNER}/${env.GITHUB_REPO} discord server`);
        }
    }

    const url = generateGithubOauthUrl(host);
    const token = await discordCookie.set(user.id, user.username, user.avatar);

    return new Response(null, {
        status: 302,
        headers: {
            Location: url,
            "Set-Cookie": `discord=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`
        }
    });
}

async function exchangeToken(env: Env, host: string, code: string) {
    const params = new URLSearchParams();

    params.append("client_id", env.DISCORD_CLIENT_ID);
    params.append("client_secret", env.DISCORD_CLIENT_SECRET);
    params.append("redirect_uri", getRedirectUri(host, "discord"));
    params.append("grant_type", "authorization_code");
    params.append("code", code);

    const access = await discord.post(Routes.oauth2TokenExchange(), {
        auth: false,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            accept: "application/json"
        },
        body: params,
        passThroughBody: true
    }) as RESTPostOAuth2AccessTokenResult | { error_description: string; };

    return access;
}

async function getUserAndMember(rest: REST, env: Env) {
    const [userResponse, memberResponse] = await Promise.allSettled([
        rest.get(Routes.user()) as Promise<RESTGetAPIUserResult | RESTError>,
        rest.get(Routes.userGuildMember(env.DISCORD_SERVER_ID)) as Promise<RESTGetAPIGuildMemberResult | RESTError>
    ]);

    const user = userResponse.status === "fulfilled"
        ? userResponse.value
        : undefined;

    const member = memberResponse.status === "fulfilled"
        ? memberResponse.value
        : undefined;

    return { user, member };
}

// The Authorization header must be a Bot token (belonging to the same application used for authorization)
// https://discord.com/developers/docs/resources/guild#add-guild-member
async function addMemberToServer(userId: string, token: string, env: Env) {
    return discord.put(Routes.guildMember(env.DISCORD_SERVER_ID, userId), {
        body: {
            access_token: token
        } satisfies RESTPutAPIGuildMemberJSONBody
    }) as Promise<RESTPutAPIGuildMemberResult | null | RESTError>;
}