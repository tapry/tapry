import type { ApiHandlers } from "./api";

/**
 * Every API route. Next.js needs a physical route.ts per path under src/app/api;
 * test/routes.test.ts checks that each entry here has one, bound to the right handler.
 */
export const ROUTES: ReadonlyArray<readonly ["GET" | "POST" | "PATCH", string, keyof ApiHandlers]> = [
  ["POST", "/api/auth/signup", "signup"],
  ["POST", "/api/auth/login", "login"],
  ["POST", "/api/auth/logout", "logout"],
  ["GET", "/api/auth/me", "me"],

  ["GET", "/api/studios", "listStudios"],
  ["POST", "/api/studios", "createStudio"],
  ["GET", "/api/studios/[studioId]", "getStudio"],
  ["PATCH", "/api/studios/[studioId]", "updateStudio"],
  ["POST", "/api/studios/[studioId]/invite", "rotateInvite"],
  ["POST", "/api/studios/[studioId]/open", "openStudio"],
  ["GET", "/api/studios/[studioId]/recordings", "listRecordings"],
  ["POST", "/api/studios/[studioId]/recordings/[recordingId]/process", "processRecording"],
  ["GET", "/api/studios/[studioId]/recordings/[recordingId]/outputs/[outputId]", "downloadOutput"],

  ["POST", "/api/join", "join"],
  ["GET", "/api/time", "time"],
  ["GET", "/api/health", "health"],

  ["GET", "/api/sessions/[sessionId]/state", "sessionState"],
  ["GET", "/api/sessions/[sessionId]/events", "sessionEvents"],
  ["POST", "/api/sessions/[sessionId]/recordings", "startRecording"],
  ["POST", "/api/sessions/[sessionId]/recordings/[recordingId]/stop", "stopRecording"],
  ["POST", "/api/sessions/[sessionId]/end", "endSession"],
  ["POST", "/api/sessions/[sessionId]/call-token", "callToken"],

  ["POST", "/api/sessions/[sessionId]/tracks", "createTrack"],
  ["POST", "/api/sessions/[sessionId]/tracks/[trackId]/chunks/[seq]/upload-url", "uploadUrl"],
  ["POST", "/api/sessions/[sessionId]/tracks/[trackId]/chunks/[seq]/commit", "commitChunk"],
  ["POST", "/api/sessions/[sessionId]/tracks/[trackId]/complete", "completeTrack"],
];
