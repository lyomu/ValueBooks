import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FormCombobox } from './form';

const options = [
  { value: 'KE', label: 'Kenya' },
  { value: 'UG', label: 'Uganda' },
  { value: 'TZ', label: 'Tanzania' },
];

describe('FormCombobox', () => {
  it('filters, selects with the keyboard, and retains the selected value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FormCombobox id="country" options={options} onChange={onChange} />);

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'uga');
    expect(screen.getByRole('option', { name: 'Uganda' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('UG');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('Uganda');
  });

  it('dismisses on Escape, a second trigger click, and an outside pointer event', async () => {
    const user = userEvent.setup();
    render(
      <>
        <FormCombobox id="country" options={options} />
        <button type="button">Outside</button>
      </>,
    );
    const input = screen.getByRole('combobox');

    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.click(input);
    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await user.click(input);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('moves the active option with arrow keys and updates an uncontrolled form value', async () => {
    const user = userEvent.setup();
    render(
      <label>
        Country
        <FormCombobox id="country" name="country" defaultValue="KE" options={options} />
      </label>,
    );
    const input = screen.getByRole('combobox', { name: 'Country' });

    await user.click(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('Uganda');
    expect(screen.getByDisplayValue('UG')).toHaveAttribute('name', 'country');
  });
});
