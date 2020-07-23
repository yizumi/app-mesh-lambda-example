eslint:
	yarn eslint . --ext .js,.jsx,.ts,.tsx --fix
build: eslint
	rm -rf dist/
	node_modules/.bin/tsc -p tsconfig.json
	cp -f ./package.json ./dist
	cd dist && yarn install
	cd dist && zip -r -q dist.zip ./

deploy: build
	aws lambda update-function-code --function-name SlowDeployToQA1 --zip-file fileb://dist/dist.zip
