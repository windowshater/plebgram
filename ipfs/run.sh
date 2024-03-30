docker build -t my-ipfs-image .
docker run -d --name ipfs-daemon --restart always --cpus="1" -p 5001:5001 my-ipfs-image
