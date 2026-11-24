import { describe, expect, it } from "vitest";
import { serverOrigin } from "../src/client/api.ts";

describe("server URLs", () => {
  it("uses the HTTPS origin for a remote library", () => {
    expect(serverOrigin("https://library.example.com/")).toBe("https://library.example.com");
    expect(() => serverOrigin("http://library.example.com")).toThrow("HTTPS");
  });

  it("allows HTTP for loopback development", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const origin = `http://${host}:9022`;
      expect(serverOrigin(origin)).toBe(origin);
    }
  });
});
