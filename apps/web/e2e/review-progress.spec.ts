import { expect, firstOfType, navTo, onboard, result, test, uebungen, unit1 } from './fixtures';

test('review: an empty deck, then adding unit vocabulary and rating a card', async ({ page }) => {
  const unit = unit1();
  await onboard(page);

  await navTo(page, 'Review');
  await expect(page.getByRole('heading', { name: 'Your review deck is empty' })).toBeVisible();

  await page.goto(`/unit/${unit.id}/wortschatz`);
  await page.getByRole('button', { name: 'Add to review' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Added ${unit.vocab.length} cards.` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All in review' })).toBeDisabled();

  await navTo(page, 'Review');
  await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();
  const due = page.getByText(/^\d+ due$/);
  await expect(due).toHaveText(`${unit.vocab.length} due`);

  const card = page.getByRole('region', { name: 'Flashcard' });
  await card.getByRole('button', { name: 'Show answer' }).click();
  const ratings = page.getByRole('group', { name: 'How well did you know it?' });
  await expect(ratings.getByRole('button')).toHaveText(['Again', 'Hard', 'Good', 'Easy']);
  await ratings.getByRole('button', { name: 'Good' }).click();

  await expect(due).toHaveText(`${unit.vocab.length - 1} due`);
  await expect(card.getByRole('button', { name: 'Show answer' })).toBeVisible();

  // English → German direction hides the German word until revealed.
  await page.getByRole('radio', { name: 'English → German' }).click();
  await expect(page.getByRole('radio', { name: 'English → German' })).toHaveAttribute('aria-checked', 'true');
});

test('progress: renders stats and the skill radar after answering an exercise', async ({ page }) => {
  const unit = unit1();
  const { ex, index } = firstOfType(uebungen(unit), 'mcq');
  await onboard(page);

  await navTo(page, 'Progress');
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
  await expect(page.getByText('Answer some exercises to see your skill profile.')).toBeVisible();

  await page.goto(`/unit/${unit.id}/uebungen`);
  await page.getByRole('button', { name: new RegExp(`^Item ${index + 1}(,|$)`) }).click();
  await page.getByRole('radiogroup', { name: 'Options' }).getByRole('radio', { name: ex.options[ex.answer]!, exact: true }).click();
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result(page)).toContainText('Richtig!');

  await navTo(page, 'Progress');
  await expect(page.getByRole('img', { name: 'Skill radar chart' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('Exercises answered')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Minutes per day' })).toBeVisible();
});
