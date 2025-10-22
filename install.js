let deferredPrompt;

window.addEventListener("beforeinstallprompt", (e) => {
  // Prevent Chrome from showing the default banner
  e.preventDefault();
  deferredPrompt = e;

  // Reveal your custom button
  const installBtn = document.getElementById("install-btn");
  if (installBtn) installBtn.style.display = "block";
});

document.getElementById("install-btn")?.addEventListener("click", async () => {
  if (!deferredPrompt) return;

  // Show the real install prompt
  deferredPrompt.prompt();

  const { outcome } = await deferredPrompt.userChoice;
  console.log(`User response to install prompt: ${outcome}`);

  deferredPrompt = null;
});
