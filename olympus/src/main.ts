const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Olympus mount point '#app' was not found.");
}

app.innerHTML = `
  <main>
    <h1>Olympus</h1>
    <p>Aegis dashboard shell initialized.</p>
  </main>
`;
