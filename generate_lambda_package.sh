#!/bin/bash
set -ex

mkdir build

cp ./lambda/package.json ./build
cp ./lambda/package-lock.json ./build
cp ./lambda/lambda.js ./build

pushd build

npm i

zip -r ../lambda_package.zip ./

popd

rm -rf build
