import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { searchYelp } from "../tools/yelp.js";

const mockYelpResponse = {
  businesses: [
    {
      name: "Central Park Tours",
      rating: 4.5,
      categories: [{ title: "Tours" }],
      location: { address1: "123 Central Park W" },
    },
  ],
  total: 1,
};

describe("searchYelp", () => {
  beforeEach(() => {
    process.env.YELP_API_KEY = "test-yelp-key";
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockYelpResponse),
      } as Response),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.YELP_API_KEY;
  });

  test("calls yelp businesses/search endpoint", async () => {
    await searchYelp("museums", "New York", 5);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.yelp.com/v3/businesses/search"),
      expect.anything(),
    );
  });

  test("encodes term and location in query string", async () => {
    await searchYelp("fine dining", "New York", 5);
    const url = (global.fetch as unknown as ReturnType<typeof mock>).mock
      .calls[0][0] as string;
    expect(url).toContain("term=fine%20dining");
    expect(url).toContain("location=New%20York");
    expect(url).toContain("limit=5");
  });

  test("sends bearer token from YELP_API_KEY", async () => {
    await searchYelp("museums", "New York", 5);
    const opts = (global.fetch as unknown as ReturnType<typeof mock>).mock
      .calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-yelp-key",
    );
  });

  test("returns parsed JSON", async () => {
    const result = await searchYelp("museums", "New York", 5);
    expect(result).toEqual(mockYelpResponse);
  });

  test("throws if YELP_API_KEY is not set", async () => {
    delete process.env.YELP_API_KEY;
    await expect(searchYelp("museums", "New York", 5)).rejects.toThrow(
      "YELP_API_KEY not set",
    );
  });

  test("throws on non-ok response", async () => {
    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 429 } as Response),
    ) as unknown as typeof fetch;
    await expect(searchYelp("museums", "New York", 5)).rejects.toThrow(
      "Yelp API error: 429",
    );
  });
});
