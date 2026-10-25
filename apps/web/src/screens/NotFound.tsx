import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';

export function NotFound() {
  return (
    <EmptyState title="Seite nicht gefunden" action={<Link className="btn-primary" to="/learn">Back to Learn</Link>}>
      This page doesn't exist.
    </EmptyState>
  );
}
