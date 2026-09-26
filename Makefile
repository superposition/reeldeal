.PHONY: dev test smoke chain deploy

dev:
	bun run dev

test:
	bun run test

smoke:
	bun run smoke

chain:
	bun run chain

deploy:
	bun run deploy
