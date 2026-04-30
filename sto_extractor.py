#!/usr/bin/env python
import sys
import datetime

offset = 0
HEADER_SIZE = 12  # 4 bytes for key, 2 for version, 4 for TOC offset, 2 for num files


def DOS_time_to_unix_timestamp(dos_time):
    # DOS time is a 32-bit value with the following structure:
    # Bits 0-4: seconds divided by 2 (0-29)
    # Bits 5-10: minutes (0-59)
    # Bits 11-15: hours (0-23)
    # Bits 16-20: day of month (1-31)
    # Bits 21-24: month (1-12)
    # Bits 25-31: years since 1980 (0-127)

    seconds = (dos_time & 0x1F) * 2
    minutes = (dos_time >> 5) & 0x3F
    hours = (dos_time >> 11) & 0x1F
    day = (dos_time >> 16) & 0x1F
    month = (dos_time >> 21) & 0x0F
    year = ((dos_time >> 25) & 0x7F) + 1980

    dt = datetime.datetime(year, month, day, hours, minutes, seconds)
    return int(dt.timestamp())


def getNextSlice(data, size):
    global offset
    slice = data[offset : offset + size]
    offset += size
    return slice


def parse_sto(data):
    global offset
    offset = 0
    # format starts with a key
    KEY = 0x01234567
    if len(data) < 4:
        raise ValueError("Invalid .sto file: too short to contain key.")
    key = int.from_bytes(getNextSlice(data, 4), byteorder="little")
    if key != KEY:
        raise ValueError(
            f"Invalid .sto file: incorrect key (expected {KEY:08X}, got {key:08X})."
        )
    version = int.from_bytes(getNextSlice(data, 2), byteorder="little")
    print(f"STO version: {version}")
    toc_offset = int.from_bytes(getNextSlice(data, 4), byteorder="little")
    num_files = int.from_bytes(getNextSlice(data, 2), byteorder="little")
    print(f"Number of files: {num_files}")
    print(f"TOC offset: {hex(toc_offset)}")

    toc = data[toc_offset + HEADER_SIZE:]
    files = []
    offset = 0
    for i in range(num_files):
        filepos = int.from_bytes(getNextSlice(toc, 4), byteorder="little")
        filelen = int.from_bytes(getNextSlice(toc, 4), byteorder="little")
        filetime = int.from_bytes(getNextSlice(toc, 4), byteorder="little")
        unixtime = DOS_time_to_unix_timestamp(filetime)
        timestr = datetime.datetime.fromtimestamp(unixtime).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        fileAttr = int.from_bytes(getNextSlice(toc, 4), byteorder="little")
        clen = int.from_bytes(getNextSlice(toc, 2), byteorder="little")
        filename = getNextSlice(toc, clen).decode("utf-8")
        print(
            f"File {i}: {filename} (pos: {hex(filepos)}, len: {filelen}, time: {timestr}, attr: {fileAttr})"
        )
        filedata = data[filepos : filepos + filelen]
        files.append({"name": filename, "size": filelen, "data": filedata})
    return files


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python sto_extractor.py <input_file.sto>")
        sys.exit(1)

    input_files = sys.argv[1:]
    for input_file in input_files:
        if not input_file.lower().endswith(".sto"):
            print("Error: Input file must have a .sto extension.")
            sys.exit(1)

        with open(input_file, "rb") as f:
            data = f.read()
            files = parse_sto(data)
            for file in files:
                print(f"Extracted file: {file['name']} (size: {file['size']} bytes)")
                with open("./out/" + file["name"], "wb") as out_file:
                    out_file.write(file["data"])
