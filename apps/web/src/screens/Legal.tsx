// /terms and /imprint (docs/legal/*.md, bundled at build time). Lazy-loaded.
import terms from '../../../../docs/legal/TERMS.md?raw';
import imprint from '../../../../docs/legal/IMPRINT.md?raw';
import { LegalPage, withoutTitle } from '../components/LegalPage';

export function Terms() {
  return <LegalPage title="Terms of use" text={withoutTitle(terms)} />;
}

export function Imprint() {
  return <LegalPage title="Imprint" text={withoutTitle(imprint)} />;
}
