docker build -t redis-plebgram .
docker run --name redis-plebgram-container -p 6379:6379 -d redis-plebgram
