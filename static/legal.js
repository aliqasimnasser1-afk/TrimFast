"use strict";

try {
  const savedTheme = localStorage.getItem("trimfast-theme");
  document.documentElement.dataset.theme = savedTheme === "dark" ? "dark" : "light";
} catch (_error) {
  document.documentElement.dataset.theme = "light";
}
