PORT ?= 42069

.PHONY: serve test

serve:
	python -m http.server ${PORT}

test:
	node test.js

save:
	rm -rf results/*.json
	node test.js --save
