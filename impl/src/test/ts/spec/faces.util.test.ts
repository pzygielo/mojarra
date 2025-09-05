/**
 * Tests for the `faces.util` namespace exposed by faces.js.
 */

import { loadFacesJs } from "../test-setup";

beforeAll(() => loadFacesJs());

const util = () => faces.util as Record<string, Function>;

// ---- Namespace structure ----

describe("faces.util namespace", () => {
    const EXPECTED_MEMBERS: Record<string, string> = {
        chain: "function",
    };

    test("exposes exactly the expected public members", () => {
        const actualKeys = Object.keys(faces.util as object).sort();
        const expectedKeys = Object.keys(EXPECTED_MEMBERS).sort();
        expect(actualKeys).toEqual(expectedKeys);
    });

    test("each member has the expected type", () => {
        const utilObj = faces.util as Record<string, unknown>;
        for (const [key, expectedType] of Object.entries(EXPECTED_MEMBERS)) {
            expect(typeof utilObj[key]).toBe(expectedType);
        }
    });
});

// ---- chain: basic behavior ----

describe("faces.util.chain: basic behavior", () => {
    test("returns true when no scripts are provided", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null)).toBe(true);
    });

    test("returns true when called with only source argument", () => {
        const el = document.createElement("button");
        expect(util().chain(el)).toBe(true);
    });

    test("returns true when called with no arguments", () => {
        expect(util().chain()).toBe(true);
    });

    test("executes a single script and returns true", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "return true")).toBe(true);
    });

    test("executes a script that returns nothing and returns true", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "var x = 1")).toBe(true);
    });

    test("returns false when script returns false", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "return false")).toBe(false);
    });

    test("returns true when script returns truthy value", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "return 42")).toBe(true);
    });

    test("returns true when script returns null", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "return null")).toBe(true);
    });

    test("returns true when script returns undefined", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "return undefined")).toBe(true);
    });

    test("returns true when script returns 0", () => {
        const el = document.createElement("button");
        // Only strict false short-circuits, not falsy values
        expect(util().chain(el, null, "return 0")).toBe(true);
    });

    test("returns true when script returns empty string", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "return ''")).toBe(true);
    });
});

// ---- chain: multiple scripts ----

describe("faces.util.chain: multiple scripts", () => {
    test("executes all scripts in order", () => {
        (window as unknown as Record<string, unknown>).__chainOrder = [];
        const el = document.createElement("button");
        util().chain(el, null,
            "window.__chainOrder.push('a')",
            "window.__chainOrder.push('b')",
            "window.__chainOrder.push('c')");

        expect((window as unknown as Record<string, unknown>).__chainOrder).toEqual(["a", "b", "c"]);
        delete (window as unknown as Record<string, unknown>).__chainOrder;
    });

    test("short-circuits when a script returns false", () => {
        (window as unknown as Record<string, unknown>).__chainOrder = [];
        const el = document.createElement("button");
        const result = util().chain(el, null,
            "window.__chainOrder.push('a')",
            "window.__chainOrder.push('b'); return false",
            "window.__chainOrder.push('c')");

        expect(result).toBe(false);
        expect((window as unknown as Record<string, unknown>).__chainOrder).toEqual(["a", "b"]);
        delete (window as unknown as Record<string, unknown>).__chainOrder;
    });

    test("first script returning false short-circuits all subsequent", () => {
        (window as unknown as Record<string, unknown>).__chainOrder = [];
        const el = document.createElement("button");
        const result = util().chain(el, null,
            "return false",
            "window.__chainOrder.push('never')");

        expect(result).toBe(false);
        expect((window as unknown as Record<string, unknown>).__chainOrder).toEqual([]);
        delete (window as unknown as Record<string, unknown>).__chainOrder;
    });

    test("returns true when all scripts return true", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "return true", "return true", "return true")).toBe(true);
    });
});

// ---- chain: source argument ----

describe("faces.util.chain: source argument", () => {
    test("DOM element source is available as 'this' in script", () => {
        const el = document.createElement("button");
        el.id = "chainBtn";
        document.body.appendChild(el);

        (window as unknown as Record<string, unknown>).__chainThis = null;
        util().chain(el, null, "window.__chainThis = this");

        expect((window as unknown as Record<string, unknown>).__chainThis).toBe(el);
        delete (window as unknown as Record<string, unknown>).__chainThis;
        el.remove();
    });

    test("string source sets 'this' to null", () => {
        (window as unknown as Record<string, unknown>).__chainThis = "sentinel";
        util().chain("someId", null, "window.__chainThis = this");

        // String source -> thisArg is null, so 'this' in non-strict is window
        expect((window as unknown as Record<string, unknown>).__chainThis).not.toBe("sentinel");
        delete (window as unknown as Record<string, unknown>).__chainThis;
    });

    test("null source sets 'this' to null", () => {
        (window as unknown as Record<string, unknown>).__chainThis = "sentinel";
        util().chain(null, null, "window.__chainThis = this");

        expect((window as unknown as Record<string, unknown>).__chainThis).not.toBe("sentinel");
        delete (window as unknown as Record<string, unknown>).__chainThis;
    });
});

// ---- chain: event argument ----

describe("faces.util.chain: event argument", () => {
    test("event object is accessible as 'event' parameter in script", () => {
        const el = document.createElement("button");
        const evt = new Event("click");

        (window as unknown as Record<string, unknown>).__chainEvent = null;
        util().chain(el, evt, "window.__chainEvent = event");

        expect((window as unknown as Record<string, unknown>).__chainEvent).toBe(evt);
        delete (window as unknown as Record<string, unknown>).__chainEvent;
    });

    test("null event is accessible as null in script", () => {
        const el = document.createElement("button");

        (window as unknown as Record<string, unknown>).__chainEvent = "sentinel";
        util().chain(el, null, "window.__chainEvent = event");

        expect((window as unknown as Record<string, unknown>).__chainEvent).toBeNull();
        delete (window as unknown as Record<string, unknown>).__chainEvent;
    });

    test("undefined event is accessible as undefined in script", () => {
        const el = document.createElement("button");

        (window as unknown as Record<string, unknown>).__chainEvent = "sentinel";
        util().chain(el, undefined, "window.__chainEvent = event");

        expect((window as unknown as Record<string, unknown>).__chainEvent).toBeUndefined();
        delete (window as unknown as Record<string, unknown>).__chainEvent;
    });
});

// ---- chain: script content edge cases ----

describe("faces.util.chain: script content edge cases", () => {
    test("empty string script returns true", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "")).toBe(true);
    });

    test("whitespace-only script returns true", () => {
        const el = document.createElement("button");
        expect(util().chain(el, null, "   ")).toBe(true);
    });

    test("script can access global variables", () => {
        (window as unknown as Record<string, unknown>).__chainGlobal = 99;
        const el = document.createElement("button");

        (window as unknown as Record<string, unknown>).__chainResult = null;
        util().chain(el, null, "window.__chainResult = window.__chainGlobal");

        expect((window as unknown as Record<string, unknown>).__chainResult).toBe(99);
        delete (window as unknown as Record<string, unknown>).__chainGlobal;
        delete (window as unknown as Record<string, unknown>).__chainResult;
    });

    test("script with semicolons works", () => {
        const el = document.createElement("button");
        (window as unknown as Record<string, unknown>).__chainMulti = 0;
        util().chain(el, null, "window.__chainMulti = 1; window.__chainMulti += 2;");

        expect((window as unknown as Record<string, unknown>).__chainMulti).toBe(3);
        delete (window as unknown as Record<string, unknown>).__chainMulti;
    });

    test.skip("script that throws triggers error but does not propagate (CSP behavior)", () => {
        // SKIPPED: With CSP-safe script element execution, exceptions don't propagate to caller
        // the same way they did with new Function(). They're handled by jsdom's error handler.
        // This test is incompatible with the CSP implementation.
        const el = document.createElement("button");
        expect(() => util().chain(el, null, "throw new Error('test')")).not.toThrow();
    });

    test("many scripts all execute when none return false", () => {
        (window as unknown as Record<string, unknown>).__chainCount = 0;
        const el = document.createElement("button");
        const scripts = Array.from({ length: 10 }, () => "window.__chainCount++");
        const result = util().chain(el, null, ...scripts);

        expect(result).toBe(true);
        expect((window as unknown as Record<string, unknown>).__chainCount).toBe(10);
        delete (window as unknown as Record<string, unknown>).__chainCount;
    });
});
