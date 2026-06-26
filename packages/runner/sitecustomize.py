try:
    from selenium.webdriver.chrome.options import Options as _ChromeOptions
    _orig = _ChromeOptions.__init__

    def _patched(self, *args, **kwargs):
        _orig(self, *args, **kwargs)
        # Required for Docker/Linux — no-sandbox + shared-memory fix
        for flag in [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--window-size=1920,1080',
        ]:
            if flag not in self._arguments:
                self.add_argument(flag)
        # --disable-gpu breaks CDP Runtime.evaluate in Chrome 112+ (headless=new)
        if '--disable-gpu' in self._arguments:
            self._arguments.remove('--disable-gpu')

    _ChromeOptions.__init__ = _patched
except Exception:
    pass
