const WHATSAPP_NUMBER = "2349128704452";
const products = [
  { id: "soft", name: "Everyday Soft Glam", category: "Soft Glam", image: "Image/2faces.jpg", description: "Fresh skin, soft definition and a polished finish." },
  { id: "full", name: "Signature Full Glam", category: "Full Glam", image: "https://images.unsplash.com/photo-1524250502761-1ac6f2e30d43?auto=format&fit=crop&w=900&q=85", description: "A statement look for your unforgettable moments." },
  { id: "birthday", name: "Birthday Beat", category: "Special Occasion", image: "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=900&q=85", description: "Camera-ready makeup for your main-character moment." },
  { id: "photo", name: "Photoshoot Glam", category: "Special Occasion", image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=900&q=85", description: "Beautifully balanced makeup that photographs beautifully." },
  { id: "grad", name: "Graduation Glow", category: "Graduation", image: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=85", description: "A timeless, confident look for your big day." },
  { id: "consult", name: "Makeup Consultation", category: "Consultation", image: "https://images.unsplash.com/photo-1512290923902-8a9f81dc236c?auto=format&fit=crop&w=900&q=85", description: "Personalized guidance for your skin, style and occasion." }
];
const quantities = {};
let activeFilter = "All looks";

function renderFilters() {
  const categories = ["All looks", ...new Set(products.map(p => p.category))];
  document.querySelector("#filters").innerHTML = categories.map(category =>
    `<button class="filter ${category === activeFilter ? "active" : ""}" data-filter="${category}">${category}</button>`
  ).join("");
  document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      renderFilters();
      renderProducts();
    });
  });
}
function renderProducts() {
  const shown = activeFilter === "All looks" ? products : products.filter(p => p.category === activeFilter);
  document.querySelector("#products").innerHTML = shown.map((p, index) => `
    <article class="product">
      <div class="product-img"><img src="${p.image}" alt="${p.name}" loading="lazy"><small>LOOK ${String(index + 1).padStart(2, "0")}</small><button class="quick-add" data-add="${p.id}" aria-label="Add ${p.name}">+</button></div>
      <div class="product-info"><small class="category">${p.category}</small><h3>${p.name}</h3><p>${p.description}</p>
      <div class="product-bottom"><div class="quantity"><button data-dec="${p.id}" aria-label="Decrease quantity">−</button><span>${quantities[p.id] || 0}</span><button data-inc="${p.id}" aria-label="Increase quantity">+</button></div></div></div>
    </article>`).join("");
  document.querySelectorAll("[data-add], [data-inc]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.add || button.dataset.inc;
    quantities[id] = (quantities[id] || 0) + 1;
    renderProducts(); updateSelection();
  }));
  document.querySelectorAll("[data-dec]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.dec;
    quantities[id] = Math.max(0, (quantities[id] || 0) - 1);
    renderProducts(); updateSelection();
  }));
}
function updateSelection() {
  const count = products.reduce((sum, p) => sum + (quantities[p.id] || 0), 0);
  document.querySelector("#cart-count").textContent = `${count} item${count === 1 ? "" : "s"}`;
  document.querySelector("#order-summary").textContent = `${count} selected look${count === 1 ? "" : "s"}`;
}
function sendEnquiry() {
  const selected = products.filter(p => (quantities[p.id] || 0) > 0);
  if (!selected.length) { alert("Choose at least one look before making an enquiry."); return; }
  const lines = selected.map(p => `• ${p.name} × ${quantities[p.id]}`);
  const message = `Hello Glammed By Dhee ✨ I would like to enquire about:\n\n${lines.join("\n")}\n\nPlease share current pricing and confirm availability.\nName:\nPreferred date/time:\nLocation:`;
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
}
document.querySelector("#order-now").addEventListener("click", sendEnquiry);
document.querySelector("#year").textContent = new Date().getFullYear();

const themeButtons = [document.querySelector("#theme-toggle"), document.querySelector("#theme-toggle-mobile")].filter(Boolean);
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("gbd-theme", theme); } catch {}
  themeButtons.forEach(button => {
    button.innerHTML = theme === "dark" ? '☀ <span>Light mode</span>' : '☾ <span>Dark mode</span>';
    button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  });
}
let savedTheme = "light";
try { savedTheme = localStorage.getItem("gbd-theme") || "light"; } catch {}
setTheme(savedTheme);
themeButtons.forEach(button => button.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")));
renderFilters();
renderProducts();
updateSelection();
