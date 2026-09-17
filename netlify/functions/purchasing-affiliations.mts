import { getUser } from "@netlify/identity";
import { getStore } from "@netlify/blobs";

const approvedEmails = new Set([
  "theresa@evologicsamerica.com",
  "dan@effitt.com",
  "wendy@evologicsamerica.com",
  "eda@evologicsamerica.com",
  "mike@evologicsamerica.com",
  "rgray@evologicsamerica.com",
  "jim@evologicsamerica.com",
  "sam@evologicsamerica.com"
]);

export default async (request: Request) => {
  const headers = { "cache-control": "no-store" };
  if (request.method !== "GET") return Response.json({ message: "Method not allowed." }, { status: 405, headers });
  const user = await getUser();
  if (!approvedEmails.has(user?.email?.trim().toLowerCase() ?? "")) {
    return Response.json({ message: "Sign in with an approved Evologics dashboard account." }, { status: 401, headers });
  }
  try {
    const mapping = await getStore({ name: "purchasing-affiliations", consistency: "strong" }).get("current", { type: "json" });
    if (!mapping) return Response.json({ message: "Purchasing research has not been loaded." }, { status: 503, headers });
    return Response.json(mapping, { headers });
  } catch {
    return Response.json({ message: "Purchasing research is temporarily unavailable." }, { status: 503, headers });
  }
};

export const config = { path: "/api/purchasing-affiliations" };
