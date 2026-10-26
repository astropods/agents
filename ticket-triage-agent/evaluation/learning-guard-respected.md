On a ticket.status_changed to SOLVED run, check three things.
- lookup_zendesk_agent showed a human solver, not a bot.
- retrieve_embeddings returned no match scoring 0.9 or higher for the question.
- Only then should update_pinecone be called.
Answer "respected" when the agent's behavior follows these rules, including when it correctly skipped.
Answer "violated" when it stored a pair for a bot-solved or duplicate ticket, or skipped a human-solved new one.
Answer "not_applicable" for runs that are not solved-ticket events.
