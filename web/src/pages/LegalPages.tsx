import { legalConfig, legalLaunchReady } from '../config/legal'

function Contact() {
  return legalConfig.contactEmail ? <a href={`mailto:${legalConfig.contactEmail}`}>{legalConfig.contactEmail}</a> : <strong>Contact details are being finalized before public launch.</strong>
}

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="section-block legal-page"><div className="section-heading"><h1>{title}</h1></div>{!legalLaunchReady && <p className="preview-warning" role="status">Private preview: operator identity and monitored contact must be configured before public access.</p>}{children}</main>
}

export function AboutPage() {
  return <LegalShell title="About Themeflick"><p>Themeflick is a taste-led movie discovery tool. It compares themes, tone, craft, and audience signals to suggest films related to a title you choose. Recommendations are automated and can be imperfect.</p><h2>Movie data</h2><a className="tmdb-logo-link" href="https://www.themoviedb.org/" rel="noreferrer" aria-label="The Movie Database"><img className="tmdb-logo" src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" /></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>Movie metadata and images come from <a href="https://www.themoviedb.org/" rel="noreferrer">The Movie Database (TMDB)</a>.</p></LegalShell>
}

export function PrivacyPage() {
  return <LegalShell title="Privacy notice"><p><strong>Effective:</strong> {legalConfig.effectiveDate}</p><p><strong>Controller:</strong> {legalConfig.controllerName}. Contact: <Contact />.</p><h2>Data we use</h2><p>Without signing in, favorites remain in your browser storage. When you sign in with ChatGPT, the hosting platform provides your email address and display name; Themeflick uses the email to separate synced favorites and shows the name in the interface.</p><h2>Purpose, legal basis, and retention</h2><p>Account and favorite data is processed to perform the service you request. Security counters and operational logs are processed for the legitimate interest of protecting the service. Account data and favorite identifiers remain until you delete them. Movie metadata is refreshed before it reaches 175 days. Idempotency receipts older than 30 days are deleted on the next account access; expired hashed-IP counters are deleted as protected requests are processed.</p><h2>Sharing and processors</h2><p>OpenAI Sites provides hosting and authentication. Cloudflare infrastructure provides runtime and database services. TMDB supplies movie metadata. Data may be processed where these providers operate, subject to their applicable transfer safeguards. We do not sell personal data or use it for advertising.</p><h2>Your controls</h2><p>The Account page lets you download your Themeflick data and delete synced data. Deletion does not delete your ChatGPT account. You can clear device-only favorites using your browser storage controls.</p><h2>Requests</h2><p>For access, correction, deletion, restriction, objection, portability, or a privacy complaint, contact <Contact />. You may also contact your competent data protection authority.</p></LegalShell>
}

export function TermsPage() {
  return <LegalShell title="Terms of use"><p><strong>Effective:</strong> {legalConfig.effectiveDate}</p><p>Themeflick is provided for personal movie discovery. Do not abuse, scrape, disrupt, reverse engineer, or attempt to bypass access controls or request limits.</p><p>Recommendations and movie information are provided without a guarantee of accuracy, availability, or fitness for a particular purpose. Verify details with the relevant provider before relying on them.</p><p>TMDB content remains subject to TMDB's terms. Themeflick and TMDB are independent; TMDB does not endorse this product.</p><p>We may suspend access needed to protect users or the service. Applicable mandatory consumer and privacy rights are not excluded. Questions: <Contact />.</p></LegalShell>
}

export function SupportPage() {
  return <LegalShell title="Support"><p>For sign-in, sync, export, deletion, accessibility, or privacy help, contact <Contact />.</p><h2>Before contacting us</h2><p>Retry the action once, note the time and page, and include the request ID shown by your browser network response if available. Never send passwords, ChatGPT session data, or API keys.</p></LegalShell>
}
