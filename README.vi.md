# Kindle Local Sync

Công cụ nhập highlight và ghi chú Kindle vào Obsidian, hoạt động hoàn toàn cục bộ.

Kindle Local Sync là plugin Obsidian chỉ dành cho desktop. Plugin đọc file `My Clippings.txt` cục bộ từ Kindle được kết nối qua USB, rồi ghi highlight và ghi chú Kindle thành các file Markdown bên trong vault Obsidian của bạn.

## Demo

![Kindle Local Sync demo](docs/assets/demo.gif)

Demo: thiết lập đường dẫn cục bộ đến `My Clippings.txt`, sync highlight Kindle, và xem ghi chú Markdown được tạo.

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

## Languages

- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

## Cài đặt từ Obsidian Community Plugins

Từ thư mục plugin cộng đồng (sau khi được phê duyệt):

Settings → Community plugins → Browse → tìm "Kindle Local Sync" → Install → Enable.

## Bắt đầu nhanh

1. Kết nối Kindle bằng USB.
2. Mở Obsidian.
3. Cài đặt và bật **Kindle Local Sync**.
4. Thiết lập **My clippings.txt path** nếu plugin không tự phát hiện Kindle.
5. Chọn biểu tượng quyển sách trên ribbon, hoặc chạy **Sync local kindle highlights** từ command palette.
6. Mở thư mục highlights đã cấu hình để kiểm tra các ghi chú được tạo.

## Cách hoạt động

1. Plugin phát hiện `My Clippings.txt` từ Kindle đang kết nối hoặc từ đường dẫn được cấu hình thủ công.
2. Plugin đọc file clipping cục bộ dưới dạng văn bản UTF-8.
3. Plugin phân tích highlight và ghi chú Kindle, đồng thời bỏ qua bookmark.
4. Plugin nhóm clipping theo sách.
5. Plugin tạo thư mục highlights đã cấu hình nếu cần.
6. Plugin ghi hoặc cập nhật một ghi chú Markdown cho mỗi sách.

Plugin chỉ quản lý nội dung nằm giữa các marker này:

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

Nội dung bên ngoài các marker này được giữ nguyên.

## Quyền riêng tư

Kindle Local Sync được thiết kế để hoạt động local-only.

- No Amazon login.
- No Readwise integration.
- No cloud sync.
- No telemetry.
- No external APIs.
- No network requests.
- Không có nội dung vault nào rời khỏi máy của bạn thông qua plugin này.

Plugin đọc `My Clippings.txt` từ filesystem cục bộ và ghi các file Markdown bên trong vault Obsidian của bạn.

## Khắc phục sự cố

- **Plugin chưa xuất hiện**: Cài từ Obsidian Community Plugins sau khi plugin được phê duyệt. Trước thời điểm đó, hãy dùng BRAT hoặc GitHub Release ZIP nếu bạn đang thử bản beta.
- **Không tìm thấy My Clippings.txt**: Kết nối Kindle bằng USB, rồi thiết lập đường dẫn tuyệt đối trong **My clippings.txt path** của phần cài đặt plugin.
- **Không có highlight nào được nhập**: Kiểm tra Kindle có file `My Clippings.txt` cục bộ và file đó có highlight hoặc note, không chỉ bookmark.
- **Lần sync thứ hai không thay đổi gì**: Đây là hành vi bình thường nếu các clipping đó đã được nhập. Plugin tránh tạo highlight và file trùng lặp.
- **Bạn thêm ghi chú riêng vào file được tạo**: Hãy đặt nội dung cá nhân bên ngoài các marker `kindle-local-sync` để nội dung đó được giữ nguyên ở các lần sync sau.

## Roadmap

- Thêm fixture parser từ nhiều biến thể clipping Kindle thực tế hơn.
- Thêm manual QA trên macOS, Windows và Linux.
- Checklist đóng gói release cho quy trình gửi plugin cộng đồng.
- Tinh chỉnh định dạng ghi chú tùy theo phản hồi người dùng.
