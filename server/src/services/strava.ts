/**
 * Strava OAuth and API client. Tokens stored in DB; this module does HTTP only.
 */

const STRAVA_OAUTH_AUTHORIZE = "https://www.strava.com/oauth/authorize";
const STRAVA_OAUTH_TOKEN = "https://www.strava.com/api/v3/oauth/token";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";

const SCOPES = "activity:read_all,read";

export function getAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state?: string;
}): string {
  const url = new URL(STRAVA_OAUTH_AUTHORIZE);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  if (params.state) url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri?: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
}> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    grant_type: "authorization_code",
  });
  const res = await fetch(STRAVA_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Strava token exchange failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  return data;
}

export async function refreshAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
}> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
  const res = await fetch(STRAVA_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Strava token refresh failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  return data;
}

/** Call Strava API with Bearer token. */
async function stravaFetch(
  path: string,
  accessToken: string,
  options?: RequestInit
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${STRAVA_API_BASE}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options?.headers,
    },
  });
}

/** List recent activities (last 30 for testing; configurable). */
export async function getActivities(accessToken: string, limit = 30): Promise<StravaActivitySummary[]> {
  const res = await stravaFetch(
    `/athlete/activities?per_page=${Math.min(Math.max(1, limit), 200)}`,
    accessToken
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Strava activities failed: ${res.status} ${err}`);
  }
  return res.json();
}

/** Get activity by ID with full details. */
export async function getActivity(
  activityId: string | number,
  accessToken: string
): Promise<StravaActivity> {
  const res = await stravaFetch(`/activities/${activityId}`, accessToken);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Strava activity failed: ${res.status} ${err}`);
  }
  return res.json();
}

/** Get laps for an activity. */
export async function getActivityLaps(
  activityId: string | number,
  accessToken: string
): Promise<StravaLap[]> {
  const res = await stravaFetch(`/activities/${activityId}/laps`, accessToken);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Strava laps failed: ${res.status} ${err}`);
  }
  return res.json();
}

/** Get streams (time, distance, heartrate). */
export async function getActivityStreams(
  activityId: string | number,
  accessToken: string
): Promise<StravaStream[]> {
  const res = await stravaFetch(
    `/activities/${activityId}/streams?keys=time,distance,heartrate`,
    accessToken
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Strava streams failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export interface StravaActivitySummary {
  id: number;
  name: string;
  type: string;
  start_date: string;
  start_date_local: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  sport_type: string;
  has_heartrate?: boolean;
}

export interface StravaActivity extends StravaActivitySummary {
  laps?: StravaLap[];
}

export interface StravaLap {
  id: number;
  name: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  lap_index: number;
  split: number;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
}

export interface StravaStream {
  type: string;
  data: number[];
  series_type: string;
  original_size: number;
  resolution: string;
}
