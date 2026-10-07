// Shared header behavior for every ORYN page: active link, mobile menu, live block height.
(function () {
  const page = document.body.dataset.page || "home";

  // Mark the current page (and, on the landing page, the section in view).
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === page) a.setAttribute("aria-current", "page");
  });

  // Mobile menu sheet.
  const toggle = document.querySelector(".nav-toggle");
  const sheet = document.getElementById("navSheet");
  function setOpen(open) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.classList.toggle("nav-open", open);
    sheet.hidden = !open;
  }
  if (toggle && sheet) {
    toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
    sheet.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
    window.matchMedia("(min-width: 900px)").addEventListener("change", (e) => { if (e.matches) setOpen(false); });
  }

  // Live Celo block height. The landing page already streams blocks for its hero rail and
  // calls window.orynSetBlock itself, so only poll here on pages that don't.
  const targets = document.querySelectorAll("[data-block]");
  window.orynSetBlock = (n) => targets.forEach((el) => { el.textContent = "#" + n.toLocaleString("en-US"); });
  if (page !== "home") {
    async function tick() {
      if (document.hidden) return;
      try {
        const res = await fetch("https://forno.celo.org", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        });
        const json = await res.json();
        if (json.result) window.orynSetBlock(parseInt(json.result, 16));
      } catch {}
    }
    tick();
    setInterval(tick, 4000);
  }
})();
