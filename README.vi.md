# Kindle Local Sync

Công cụ nhập highlight và ghi chú Kindle vào Obsidian, hoạt động hoàn toàn cục bộ.

Ngôn ngữ:
- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

Kindle Local Sync là plugin Obsidian chỉ dành cho desktop. Plugin đọc file `My Clippings.txt` cục bộ từ Kindle được kết nối qua USB, rồi ghi highlight và ghi chú Kindle thành các file Markdown bên trong vault Obsidian của bạn.

## Công cụ này làm gì

- Phát hiện `My Clippings.txt` từ Kindle đang kết nối hoặc từ đường dẫn được cấu hình thủ công.
- Đọc file clipping cục bộ dưới dạng văn bản UTF-8.
- Phân tích highlight và ghi chú Kindle.
- Bỏ qua các mục bookmark của Kindle.
- Nhóm clipping theo sách.
- Ghi một ghi chú Markdown cho mỗi sách vào thư mục vault được cấu hình.
- Giữ nguyên nội dung do người dùng viết bên ngoài vùng sync do plugin quản lý.
- Tránh tạo nội dung trùng lặp khi cùng một clipping xuất hiện nhiều hơn một lần.

## Vì sao local-only quan trọng

Kindle Local Sync được thiết kế cho những người muốn đưa ghi chú đọc sách vào Obsidian mà không phải đi qua dịch vụ đám mây.

Plugin không yêu cầu:

- Amazon login
- Readwise
- Cloud sync
- Telemetry
- External services
- Network requests

Plugin đọc từ file Kindle cục bộ và ghi vào vault Obsidian cục bộ của bạn.

## Phù hợp nhất với ai

Plugin này đặc biệt hữu ích nếu bạn:

- Đọc sách sideloaded trên Kindle.
- Lưu ghi chú trong Obsidian.
- Ưu tiên công cụ local-first.
- Muốn tránh các dịch vụ highlight của bên thứ ba.
- Thoải mái kết nối Kindle qua USB.

## Tính năng

- Plugin Obsidian chỉ dành cho desktop.
- Nhập clipping Kindle theo hướng USB-first.
- Hỗ trợ cấu hình thủ công đường dẫn `My Clippings.txt`.
- Phát hiện đường dẫn trên macOS, Windows và Linux.
- Xuất Markdown bên trong vault Obsidian.
- Một ghi chú cho mỗi sách.
- Vùng sync được tạo tự động với clipping ID ổn định.
- Làm sạch tên file và đường dẫn thư mục an toàn.
- Có test coverage cho parser và vault writer.

## Cách hoạt động

1. Kết nối Kindle qua USB.
2. Chạy **Sync local kindle highlights** từ biểu tượng ribbon hoặc command palette.
3. Plugin tìm `My Clippings.txt`.
4. Plugin đọc và phân tích highlight và ghi chú Kindle cục bộ.
5. Plugin tạo thư mục highlights đã cấu hình nếu cần.
6. Plugin ghi hoặc cập nhật các ghi chú Markdown trong vault của bạn.

Plugin chỉ quản lý nội dung nằm giữa các marker này:

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

Nội dung bên ngoài các marker này được giữ nguyên.

## Cài đặt / cài đặt thủ công

Plugin hiện phù hợp nhất để cài qua BRAT cho beta testing cho đến khi bản gửi chính thức lên Obsidian Community Plugin sẵn sàng.

### A. Cài đặt beta được khuyến nghị: BRAT

1. Cài BRAT từ Obsidian Community Plugins.
2. Mở Command Palette.
3. Chạy `BRAT: Add a beta plugin for testing`.
4. Dán `https://github.com/mykyquan/kindle-local-sync`.
5. Bật **Kindle Local Sync** trong **Settings -> Community plugins**.

### B. Cài đặt thủ công từ GitHub Release

1. Tải file release zip mới nhất từ GitHub Releases.
2. Giải nén vào:

```text
<Vault>/.obsidian/plugins/kindle-local-sync/
```

3. Đảm bảo thư mục chứa:
   - `main.js`
   - `manifest.json`
   - `styles.css` nếu có
4. Tải lại Obsidian.
5. Bật **Kindle Local Sync** trong **Settings -> Community plugins**.

### C. Build từ source cho developer

1. Clone repository này.
2. Chạy `npm ci`.
3. Chạy `npm run build`.
4. Sao chép `main.js` và `manifest.json` vào:

```text
<Vault>/.obsidian/plugins/kindle-local-sync/
```

5. Sao chép thêm `styles.css` nếu có.
6. Tải lại Obsidian và bật plugin.

## Cách sử dụng

1. Kết nối Kindle bằng USB.
2. Mở Obsidian.
3. Chọn biểu tượng quyển sách trên ribbon, hoặc chạy **Sync local kindle highlights** từ command palette.
4. Xem Notice tóm tắt kết quả sync.
5. Mở thư mục highlights đã cấu hình để kiểm tra các ghi chú được tạo.

## Cài đặt

- **My clippings.txt path**: Đường dẫn tuyệt đối tùy chọn đến `My Clippings.txt`. Nếu để trống, plugin sẽ kiểm tra các vị trí mount Kindle USB phổ biến.
- **Highlights folder**: Thư mục trong vault nơi các ghi chú sách được tạo. Mặc định: `Kindle Highlights`.
- **Strict local only**: Giữ plugin theo định hướng local-only. Plugin hiện tại không thực hiện network sync.

## Ví dụ output

```markdown
---
title: "Atomic Habits"
author: "James Clear"
source: "kindle"
sync: "kindle-local-sync"
---

# Atomic Habits

Author: James Clear

## Kindle Highlights & Notes

<!-- kindle-local-sync:start -->

### Highlight - Location 154

> Small habits make a big difference.

Added: Thursday, May 14, 2026 2:44 PM

<!-- kindle-local-sync-id: kls-example -->

<!-- kindle-local-sync:end -->
```

## Ảnh chụp màn hình

![Kindle Local Sync demo](docs/assets/demo.gif)

Demo: cài đặt và bật plugin, thiết lập `My Clippings.txt`, sync highlight Kindle, và xem ghi chú Markdown được tạo.

## Tuyên bố quyền riêng tư

Kindle Local Sync được thiết kế để hoạt động local-only.

- No Amazon login.
- No Readwise integration.
- No cloud sync.
- No telemetry.
- No external APIs.
- No network requests.
- Không có nội dung vault nào rời khỏi máy của bạn thông qua plugin này.

Plugin đọc `My Clippings.txt` từ filesystem cục bộ và ghi các file Markdown bên trong vault Obsidian của bạn.

## Giới hạn hiện tại

- Việc xóa một highlight khỏi Kindle có thể không tự động xóa highlight đó khỏi Obsidian. `My Clippings.txt` của Kindle có thể hoạt động như một log kiểu append-style, nên plugin này được thiết kế như công cụ import/sync cục bộ an toàn và không tự động xóa nội dung hiện có trong Obsidian.
- Một số định dạng clipping theo locale của Kindle có thể cần thêm coverage cho parser theo thời gian.
- Plugin này chỉ dành cho desktop vì phụ thuộc vào quyền truy cập filesystem cục bộ.
- Ghi chú được tạo ưu tiên Markdown đơn giản.

## Lệnh phát triển

```bash
npm install
npm run build
npm run lint
npm test
```

Chế độ watch khi phát triển:

```bash
npm run dev
```

## Roadmap

- Thêm fixture parser từ nhiều biến thể clipping Kindle thực tế hơn.
- Thêm manual QA trên macOS, Windows và Linux.
- Checklist đóng gói release cho quy trình gửi plugin cộng đồng.
- Tinh chỉnh định dạng ghi chú tùy theo phản hồi người dùng.

## Phản hồi và báo lỗi

Sử dụng GitHub Issues cho bug và feature request. Dùng bug report template cho lỗi sync, cài đặt, hoặc parsing; dùng feature request template cho ý tưởng mới.

Hãy xóa highlight riêng tư, ghi chú cá nhân, và dữ liệu đọc nhạy cảm trước khi chia sẻ log hoặc ví dụ `My Clippings.txt`. Có thể dùng GitHub Discussions cho câu hỏi chung nếu tính năng này được bật.

## Đóng góp

Mọi đóng góp đều được hoan nghênh nếu vẫn giữ mô hình quyền riêng tư local-only của plugin.

Vui lòng tránh thêm:

- Cloud sync
- Telemetry
- Amazon login
- Dịch vụ highlight bên ngoài
- Network-based APIs

Trước khi mở pull request, hãy chạy:

```bash
npm run build
npm run lint
npm test
```

## Giấy phép

Dự án này được cấp phép theo MIT License. Xem [LICENSE](LICENSE).
