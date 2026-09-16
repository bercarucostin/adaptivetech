"""Executable browser regressions using macOS JavaScriptCore when Node is absent."""
import ctypes
import ctypes.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class JavaScriptCore:
    def __init__(self):
        library = ctypes.util.find_library("JavaScriptCore")
        if not library:
            raise unittest.SkipTest("JavaScriptCore unavailable; run the Node billing integration test")
        self.lib = ctypes.CDLL(library)
        pointer = ctypes.c_void_p
        for name, args, result in [
            ("JSGlobalContextCreate", [pointer], pointer),
            ("JSGlobalContextRelease", [pointer], None),
            ("JSStringCreateWithUTF8CString", [ctypes.c_char_p], pointer),
            ("JSStringRelease", [pointer], None),
            ("JSEvaluateScript", [pointer, pointer, pointer, pointer, ctypes.c_int, ctypes.POINTER(pointer)], pointer),
            ("JSValueToStringCopy", [pointer, pointer, ctypes.POINTER(pointer)], pointer),
            ("JSStringGetMaximumUTF8CStringSize", [pointer], ctypes.c_size_t),
            ("JSStringGetUTF8CString", [pointer, ctypes.c_char_p, ctypes.c_size_t], ctypes.c_size_t),
        ]:
            fn = getattr(self.lib, name)
            fn.argtypes, fn.restype = args, result
        self.context = self.lib.JSGlobalContextCreate(None)

    def evaluate(self, source):
        script = self.lib.JSStringCreateWithUTF8CString(source.encode())
        exception = ctypes.c_void_p()
        value = self.lib.JSEvaluateScript(self.context, script, None, None, 1, ctypes.byref(exception))
        self.lib.JSStringRelease(script)
        string = self.lib.JSValueToStringCopy(self.context, exception.value or value, None)
        size = self.lib.JSStringGetMaximumUTF8CStringSize(string)
        output = ctypes.create_string_buffer(size)
        self.lib.JSStringGetUTF8CString(string, output, size)
        self.lib.JSStringRelease(string)
        if exception.value:
            raise AssertionError(output.value.decode())
        return output.value.decode()

    def close(self):
        self.lib.JSGlobalContextRelease(self.context)


class BillingUiRuntime(unittest.TestCase):
    def test_deferred_requests_and_frozen_cost_rendering(self):
        runtime = JavaScriptCore()
        try:
            runtime.evaluate("var APP_SOURCE=" + json.dumps((ROOT / "website/app/app.js").read_text()) + ";")
            runtime.evaluate((ROOT / "tests/app/billing-mode-integration.test.js").read_text())
            results = json.loads(runtime.evaluate("JSON.stringify(BILLING_TEST_RESULTS)"))
            self.assertGreaterEqual(len(results), 26)
            for result in results:
                with self.subTest(case=result["name"]):
                    self.assertTrue(result["ok"], result.get("error"))
            print(f"JSC billing integration: {sum(r['ok'] for r in results)}/{len(results)} cases passed")
        finally:
            runtime.close()


if __name__ == "__main__":
    unittest.main()
