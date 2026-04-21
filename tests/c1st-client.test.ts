import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  getServerConfig: () => ({
    appTitle: "Test",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role",
    c1stApiToken: "token",
    c1stApiBaseUrl: "https://api.c1st.com/api",
    c1stDefaultPageLength: 2,
    c1stUseUpdatedAfter: false,
    c1stUpdatedAfterParam: "updated_after",
    c1stExtraTicketMaterialQuery: "",
    cykelPlusTag: "CykelPlus",
  }),
}));

import { CustomersFirstClient } from "@/lib/c1st/client";

function createJsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("CustomersFirstClient", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps content when fetching a single ticket by id", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        content: {
          id: 8550526,
          type: "repair",
          created: "2026-03-16 09:38:59",
          updated_at: "2026-04-09 18:22:51",
        },
        storeid: 1234,
      }),
    );

    const client = new CustomersFirstClient();
    const ticket = await client.getTicketById(8550526);

    expect(ticket).toMatchObject({
      ticketId: 8550526,
      ticketType: "repair",
      createdAt: "2026-03-16 09:38:59",
      updatedAt: "2026-04-09 18:22:51",
    });
  });

  it("resolves a customer tag title to its numeric id before counting tagged customers", async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              id: 18426,
              title: "CykelPlus",
              handle: "cykelplus",
            },
          ],
          count: 1,
          hasMore: false,
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              id: 101,
              name: "Customer A",
              tags: [{ id: 18426, title: "CykelPlus", handle: "cykelplus" }],
            },
            {
              id: 102,
              name: "Customer B",
              tags: [{ id: 99999, title: "Other", handle: "other" }],
            },
          ],
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              id: 103,
              name: "Customer C",
              tags: [{ id: 18426, title: "CykelPlus", handle: "cykelplus" }],
            },
          ],
          hasMore: false,
        }),
      );

    const client = new CustomersFirstClient();
    const count = await client.getCykelPlusCustomerCount("CykelPlus");

    expect(count).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);

    expect(firstUrl).toContain("/customertags?");
    expect(firstUrl).toContain("freetext=CykelPlus");
    expect(secondUrl).toContain("/customers?");
    expect(secondUrl).toContain("tags=18426");
  });
});
