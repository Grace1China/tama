# 测延迟：curl 命令列表（一个 IP 一行）

```bash
curl -w "%{time_total}\n" -o /dev/null -s https://140.82.112.4
curl -w "%{time_total}\n" -o /dev/null -s https://140.82.113.3
curl -w "%{time_total}\n" -o /dev/null -s https://140.82.114.4
curl -w "%{time_total}\n" -o /dev/null -s https://140.82.113.4
curl -w "%{time_total}\n" -o /dev/null -s https://140.82.112.3
curl -w "%{time_total}\n" -o /dev/null -s https://4.228.31.150
curl -w "%{time_total}\n" -o /dev/null -s https://140.82.121.4
curl -w "%{time_total}\n" -o /dev/null -s https://20.26.156.215
curl -w "%{time_total}\n" -o /dev/null -s https://140.82.121.3
curl -w "%{time_total}\n" -o /dev/null -s https://20.207.73.82
curl -w "%{time_total}\n" -o /dev/null -s https://20.205.243.166
curl -w "%{time_total}\n" -o /dev/null -s https://20.200.245.247
curl -w "%{time_total}\n" -o /dev/null -s https://4.237.22.38
```

去重后的 IP 共 13 个，可直接复制到终端逐条执行，或配合循环：

```bash
for ip in 140.82.112.4 140.82.113.3 140.82.114.4 140.82.113.4 140.82.112.3 4.228.31.150 140.82.121.4 20.26.156.215 140.82.121.3 20.207.73.82 20.205.243.166 20.200.245.247 4.237.22.38; do
  echo -n "$ip: "
  curl -w "%{time_total}s\n" -o /dev/null -s https://$ip
done
```
