// /privacy: the privacy policy (docs/PRIVACY.md, bundled at build time), without the operator notes.
import { Link } from 'react-router-dom';
import privacy from '../../../../docs/PRIVACY.md?raw';
import { LegalPage } from '../components/LegalPage';
import { betaActive } from '../lib/beta/config';
import { billingActive } from '../lib/billing/config';
import { learnerPrivacyText } from '../lib/beta/privacy';

const text = learnerPrivacyText(privacy);

export function Privacy() {
  const beta = betaActive();
  const billing = billingActive();
  return (
    <LegalPage title="Privacy" text={text}>
      {!beta && (
        <p className="card text-sm" role="status">
          {billing
            ? 'The beta programme is not active in this build. The app contacts our server only when you buy, redeem or restore an unlock.'
            : 'The beta programme is not active in this build: this app sends nothing to us. The beta and payment sections below describe optional services.'}
        </p>
      )}
      {beta && (
        <p className="text-sm">
          <Link to="/settings#s-beta" className="text-accent underline">
            Change your beta choices in Settings
          </Link>
        </p>
      )}
    </LegalPage>
  );
}
