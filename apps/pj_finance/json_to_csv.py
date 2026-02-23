#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将JSON数组文件转换为CSV文件
将数组中的每个对象的key作为CSV的header，value作为data行
"""
import json
import csv
import os
import sys

def convert_json_to_csv(json_path, csv_path=None):
    """
    将JSON数组转换为CSV文件
    
    Args:
        json_path: JSON文件路径
        csv_path: CSV输出路径，如果为None则使用相同目录和文件名但扩展名为.csv
    """
    # 检查输入文件是否存在
    if not os.path.exists(json_path):
        print(f"错误: 文件不存在: {json_path}")
        return False
    
    # 如果没有指定输出路径，使用相同的目录和文件名但扩展名为.csv
    if csv_path is None:
        csv_path = os.path.join(
            os.path.dirname(json_path),
            os.path.basename(json_path).rsplit('.', 1)[0] + '.csv'
        )
    
    try:
        # 读取JSON文件
        print(f"正在读取JSON文件: {json_path}")
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 检查是否为数组
        if not isinstance(data, list):
            print(f"错误: JSON文件应该包含一个数组，但得到的是 {type(data).__name__}")
            return False
        
        if len(data) == 0:
            print("警告: JSON数组为空")
            # 创建空CSV文件
            with open(csv_path, 'w', newline='', encoding='utf-8') as f:
                pass
            print(f"已创建空的CSV文件: {csv_path}")
            return True
        
        # 收集所有可能的keys（处理不同对象可能有不同keys的情况）
        all_keys = set()
        for item in data:
            if isinstance(item, dict):
                all_keys.update(item.keys())
        
        keys = sorted(list(all_keys))  # 排序以确保列的顺序一致
        print(f"发现 {len(keys)} 个列: {', '.join(keys[:5])}{'...' if len(keys) > 5 else ''}")
        print(f"总行数: {len(data)}")
        
        # 确保输出目录存在
        csv_dir = os.path.dirname(csv_path)
        if csv_dir and not os.path.exists(csv_dir):
            os.makedirs(csv_dir, exist_ok=True)
        
        # 写入CSV文件
        print(f"正在写入CSV文件: {csv_path}")
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=keys)
            writer.writeheader()
            
            for i, item in enumerate(data):
                if isinstance(item, dict):
                    # 对于缺失的key，使用空字符串
                    row = {key: item.get(key, '') for key in keys}
                    writer.writerow(row)
                else:
                    print(f"警告: 跳过非字典类型的项（索引 {i}）")
        
        print(f"成功! CSV文件已创建: {csv_path}")
        return True
        
    except json.JSONDecodeError as e:
        print(f"错误: JSON文件格式无效: {e}")
        return False
    except Exception as e:
        print(f"错误: {type(e).__name__}: {e}")
        return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python3 json_to_csv.py <input.json> [output.csv]")
        print("示例: python3 json_to_csv.py data.json data.csv")
        print("      python3 json_to_csv.py data.json  # 将自动生成 data.csv")
        sys.exit(1)
    
    json_path = sys.argv[1]
    csv_path = sys.argv[2] if len(sys.argv) > 2 else None
    
    success = convert_json_to_csv(json_path, csv_path)
    sys.exit(0 if success else 1)
