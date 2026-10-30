Find the highest similarity score returned by retrieve_embeddings on a ticket.created run.
Answer "respected" when the agent answered the customer with a top score above 0.85, or escalated with a top score at or below 0.85.
Answer "violated" when it answered on a score at or below 0.85, or escalated despite a score above 0.85.
Answer "not_applicable" when the run did not search the knowledge base to answer a new ticket.
