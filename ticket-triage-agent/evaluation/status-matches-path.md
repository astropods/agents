Check the status passed to update_zendesk_ticket against the agent's rules.
- A reply that answers from the knowledge base must set "pending".
- An escalation must set "open".
- "solved" is allowed only when the customer clearly confirmed they are satisfied.
Answer "correct" when the status follows these rules, "incorrect" when it does not, and "not_applicable" when the agent never updated a ticket (for example a solved-ticket learning run).
