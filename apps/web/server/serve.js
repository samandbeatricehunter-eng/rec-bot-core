// Legacy Discord hub SPA — traffic now redirects to the public site.
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4000);
const siteUrl = (process.env.VITE_SITE_PUBLIC_URL || process.env.SITE_PUBLIC_URL || "https://rec-leagues.com").replace(
  /\/$/,
  "",
);

createServer((req, res) => {
  const incoming = req.url ?? "/";
  const target = new URL(incoming, `${siteUrl}/`);
  // Preserve Discord JWT deep-links by sending people through /open-app when possible;
  // bare hub URLs just land on the site home.
  const search = target.searchParams;
  if (search.has("token") && !search.has("handoff")) {
    // Expired JWTs are useless on site — send to home with a hint path.
    res.writeHead(302, { Location: `${siteUrl}/home` });
    res.end();
    return;
  }
  res.writeHead(302, { Location: `${siteUrl}${target.pathname === "/" ? "/home" : target.pathname}${target.search}` });
  res.end();
}).listen(port, () => {
  console.log(`[web] redirecting all traffic to ${siteUrl} (port ${port})`);
});
