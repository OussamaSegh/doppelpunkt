// /privacy: the beta privacy notice (docs/PRIVACY.md, bundled at build time).
import { Link } from 'react-router-dom';
import privacy from '../../../../docs/PRIVACY.md?raw';
import { Markdown } from '../components/Markdown';
import { betaActive } from '../lib/beta/config';
import { learnerPrivacyText } from '../lib/beta/privacy';

const text = learnerPrivacyText(privacy);

export function Privacy() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Privacy</h1>
      {!betaActive() && (
        <p className="card text-sm" role="status">
          The beta programme is not active in this build: this app sends nothing to us. The notice below describes the beta.
        </p>
      )}
      <article className="card">
        <Markdown text={text} headings="document" className="text-sm leading-relaxed" />
      </article>
      <p className="text-sm">
        <Link to="/settings#s-beta" className="text-accent underline">
          Change your beta choices in Settings
        </Link>
      </p>
    </div>
  );
}
