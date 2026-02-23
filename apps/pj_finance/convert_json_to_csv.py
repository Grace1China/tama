#!/usr/bin/env python3
"""
将JSON数组文件转换为CSV文件
用法: python3 convert_json_to_csv.py <input.json> [output.csv]
"""
import json
import csv
import os
import sys

def json_to_csv(json_path, csv_path=None):
    """将JSON数组转换为CSV文件"""
    # 如果没有指定输出路径，使用相同的文件名但扩展名为.csv
    if csv_path is None:
        csv_path = json_path.rsplit('.', 1)[0] + '.csv'
    
    # 读取JSON文件
    print(f"Reading JSON file: {json_path}")
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: File not found: {json_path}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON file: {e}")
        sys.exit(1)
    
    if not isinstance(data, list):
        print("Error: JSON file should contain an array")
        sys.exit(1)
    
    if len(data) == 0:
        print("Warning: JSON array is empty")
        # 创建一个空CSV文件
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            pass
        print(f"Empty CSV file created at: {csv_path}")
        return
    
    # 获取所有的key作为CSV header
    # 收集所有可能的keys（因为不同对象可能有不同的keys）
    all_keys = set()
    for item in data:
        if isinstance(item, dict):
            all_keys.update(item.keys())
    
    keys = sorted(list(all_keys))  # 排序以确保顺序一致
    print(f"Found {len(keys)} columns")
    print(f"Total rows: {len(data)}")
    
    # 确保输出目录存在
    os.makedirs(os.path.dirname(csv_path) if os.path.dirname(csv_path) else '.', exist_ok=True)
    
    # 创建CSV文件
    print(f"Writing CSV file: {csv_path}")
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        for item in data:
            if isinstance(item, dict):
                # 对于缺失的key，使用空字符串
                row = {key: item.get(key, '') for key in keys}
                writer.writerow(row)
    
    print(f"CSV file created successfully: {csv_path}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 convert_json_to_csv.py <input.json> [output.csv]")
        sys.exit(1)
    
    json_path = sys.argv[1]
    csv_path = sys.argv[2] if len(sys.argv) > 2 else None
    json_to_csv(json_path, csv_path)
