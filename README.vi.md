# Kindle Local Sync

Nhập highlight và ghi chú Kindle vào Obsidian mà không gửi dữ liệu đọc sách của bạn ra ngoài.

Kindle Local Sync là plugin Obsidian chỉ dành cho desktop. Plugin đọc file `My Clippings.txt` cục bộ từ Kindle kết nối qua USB, rồi ghi những highlight bạn chấp thuận vào ghi chú Markdown trong vault.

## Demo

![Kindle Local Sync demo](docs/assets/demo.gif)

## Tính năng

- Nhập cục bộ theo hướng USB-first, không cần tài khoản Amazon hoặc Readwise.
- Tự phát hiện đường dẫn Kindle trên macOS, Windows và Linux, đồng thời cho phép nhập đường dẫn thủ công.
- Một ghi chú Markdown cho mỗi sách.
- Bước review cho lần sync đầu tiên và các highlight mới phát hiện.
- Lựa chọn Skip tạm thời và Ignore được lưu lâu dài.
- Kết nối lại với các ghi chú Kindle Local Sync hiện có khi thiếu dữ liệu sync đã lưu.
- Review khôi phục cho highlight đã nhập trước đây nhưng bị thiếu trong ghi chú Obsidian dự kiến.
- Bảo vệ nội dung cá nhân bên ngoài phần do plugin quản lý.
- Tránh clipping trùng lặp và xử lý tên file an toàn.

## Ngôn ngữ

- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

## Cài đặt từ Obsidian Community Plugins

Sau khi plugin được duyệt vào thư mục cộng đồng:

Settings → Community plugins → Browse → tìm **Kindle Local Sync** → Install → Enable.

Trước thời điểm đó, chỉ dùng BRAT hoặc GitHub Release ZIP nếu bạn đang thử bản beta.

## Bắt đầu nhanh

1. Kết nối Kindle bằng USB.
2. Mở Obsidian và bật **Kindle Local Sync**.
3. Nếu Kindle không được phát hiện, đặt **My clippings.txt path** trong phần cài đặt plugin.
4. Chọn biểu tượng quyển sách trên ribbon, hoặc chạy **Sync local kindle highlights** từ command palette.
5. Review những highlight cần lựa chọn.
6. Chọn **Finish Sync**, rồi mở thư mục highlights đã cấu hình để xem kết quả.

## Kindle Local Sync hoạt động như thế nào

1. Plugin đọc `My Clippings.txt` từ Kindle hoặc đường dẫn cục bộ bạn đã cấu hình.
2. Plugin phân tích highlight và note, bỏ qua bookmark cùng entry hỏng, rồi nhóm clipping theo sách.
3. Khi cần review, bạn chọn Import, Skip cho lần sync này, hoặc Ignore.
4. Không lựa chọn nào trong review được áp dụng cho tới khi bạn chọn **Finish Sync**.
5. Highlight được chấp thuận được ghi vào ghi chú Obsidian khớp với sách. Ghi chú mới chỉ được tạo khi một lựa chọn Import đã duyệt cần đến nó.
6. Ở các lần sync sau, plugin so sánh file Kindle hiện tại, các lựa chọn đã lưu và phần do plugin quản lý trong ghi chú hiện có.
7. Nội dung cá nhân bên ngoài phần do plugin quản lý được giữ nguyên.

`My Clippings.txt` là nguồn nhập, không phải bản ghi xóa đáng tin cậy. Plugin không tự động xóa một highlight trong Obsidian chỉ vì highlight đó không có trong file Kindle hiện tại.

## Dành cho người dùng mới

Nếu không có lịch sử sync đáng tin cậy và cũng không có ghi chú Kindle Local Sync hiện hữu, lần sync đầu mở **First Sync Preview**. Mỗi highlight bắt đầu ở trạng thái chưa có lựa chọn để bạn quyết định nội dung nào thuộc về Obsidian.

- **Import** thêm highlight khi bạn hoàn tất sync.
- **Skip This Sync** không thay đổi highlight và có thể hiển thị lại ở lần sau.
- **Ignore** giữ highlight ngoài các lần sync sau cho tới khi bạn xóa nó khỏi danh sách Ignore.

Ghi chú sách không được tạo chỉ vì bạn mở màn hình review hoặc chọn một lựa chọn tạm thời. Plugin chỉ ghi và lưu lựa chọn sau **Finish Sync**. Highlight chưa được review được xử lý như một lần Skip tạm thời và có thể quay lại ở lần sync sau.

## Dành cho người dùng quay lại

### Có lịch sử sync đã lưu

Khi `data.json` chứa lịch sử Import hoặc Ignore đáng tin cậy, các highlight đã nhập và vẫn còn marker sẽ được cập nhật tự động. Highlight đã Ignore tiếp tục nằm ngoài lần sync. Thông thường, chỉ highlight mới và highlight đã nhập nhưng đang thiếu trong ghi chú dự kiến mới cần chú ý.

Plugin không dùng `My Clippings.txt` làm quyền xóa highlight cũ khỏi Obsidian. Nếu không thể cập nhật an toàn một sách mà không làm mất nội dung managed hiện hữu, plugin giữ nguyên sách đó và giải thích trong phần tổng kết.

### Có ghi chú hiện hữu nhưng không có `data.json` đáng tin cậy

Nếu thư mục highlights đã cấu hình có một phần managed hợp lệ của Kindle Local Sync nhưng thiếu lịch sử sync đáng tin cậy, plugin hiển thị **Existing Kindle notes found**.

Chọn **Continue with existing notes** để kết nối lại:

- Marker highlight khớp chính xác trong ghi chú sách dự kiến được ghi nhận là nội dung đã nhập.
- Highlight không khớp được hiển thị trong **Review New Highlights**.
- Ghi chú hiện có được giữ tại chỗ và nội dung cá nhân bên ngoài phần managed được bảo toàn.
- Lựa chọn Ignore cũ không thể được suy ra chỉ từ Markdown, nên plugin không đoán.

Vì vậy, thông thường bạn chỉ cần review highlight không khớp, không phải duyệt lại mọi highlight cũ.

### Sau khi nâng cấp từ phiên bản cũ

Phiên bản cũ có thể đã lưu cài đặt plugin nhưng chưa lưu lịch sử highlight. Sau khi nâng cấp, bạn có thể thấy **Existing Kindle notes found**. Chọn **Continue with existing notes** để kết nối lại: plugin giữ nguyên ghi chú hiện có, nhận diện highlight có marker khớp và chỉ yêu cầu bạn review những highlight không khớp được.

Nếu không tìm thấy ghi chú Kindle Local Sync hiện hữu hợp lệ, plugin dùng **First Sync Preview**.

## Ý nghĩa của từng lựa chọn

| Lựa chọn | Điều gì xảy ra | Ví dụ |
| --- | --- | --- |
| **Import** | Tạm chọn một highlight để ghi khi bạn chọn **Finish Sync**. | Nhập một trích dẫn bạn muốn dùng trong ghi chú dự án. |
| **Skip This Sync** | Bỏ qua một highlight, hoặc toàn bộ highlight trong sách khi dùng trên card sách, chỉ cho lần sync này. Nó có thể quay lại lần sau. | Để lại một đoạn dài chưa quyết định cho lần review kế tiếp. |
| **Ignore** | Lưu lựa chọn Ignore lâu dài sau **Finish Sync**. Highlight nằm ngoài các lần sync sau cho tới khi bị xóa khỏi danh sách Ignore. | Ẩn một clipping không hữu ích. |
| **Import All** | Đổi mọi lựa chọn tạm thời trong sách đó thành Import. | Nhập tất cả clipping đang review của một sách. |
| **Ignore All** | Đổi mọi lựa chọn tạm thời trong sách đó thành Ignore. | Giữ toàn bộ highlight hiện tại của một sách ngoài các lần sync sau. |
| **Import All Books** | Đổi mọi lựa chọn trong review hiện tại, kể cả sách đang bị ẩn, thành Import. Nếu đã chọn Skip hoặc Ignore, plugin hỏi xác nhận trước. Ignore đã lưu từ trước không bị thay đổi. | Duyệt toàn bộ lần first sync cùng lúc. |
| **Finish Sync** | Áp dụng lựa chọn hiện tại, lưu trạng thái đã xác nhận và mở **Sync complete** hoặc **Sync finished**. Highlight chưa review được Skip lần này. | Hoàn tất sau khi chỉ review những sách bạn quan tâm hôm nay. |
| **Cancel** | Đóng ngay nếu không có lựa chọn thay đổi. Nếu có lựa chọn chưa lưu, plugin hỏi tiếp tục review hay bỏ lựa chọn. Search, filter, scroll và navigation không tự kích hoạt cảnh báo này. | Thoát mà không lưu lựa chọn nhầm. |

Bulk action được chọn sau sẽ có ưu tiên cao hơn lựa chọn tạm thời trước đó. Ví dụ, nếu bạn Ignore một highlight rồi chọn **Import All** cho sách đó, mọi highlight hiện tại trong sách sẽ chuyển thành Import. **Import All Books** làm điều tương tự trên toàn bộ review sau khi xác nhận. Không lựa chọn review nào được lưu trước **Finish Sync**.

### Tìm và review lựa chọn

- **Search books...** tìm theo title sách và author mà không thay đổi lựa chọn. Nó không tìm trong nội dung highlight.
- **All Books**, **Needs Review** và **Reviewed** lọc danh sách sách nhưng vẫn giữ toàn bộ trạng thái review.
- **How choices work** và nút `?` hiển thị cùng một hướng dẫn ngắn trong ứng dụng.
- **Review Highlights** mở lựa chọn cho từng highlight của một sách.

## Sync Summary và hành động tiếp theo

Sau khi sync hoàn tất, phần tổng kết báo số đã Import, Ignore, Skip, chưa review, trùng lặp hoặc bị thiếu. Tùy kết quả, nó có thể đưa ra:

- **Review Skipped This Sync**: xem các lựa chọn Skip tạm thời. Bạn có thể giữ chúng cho lần sau hoặc chọn **Ignore Going Forward**. Ở cấp sách, **Ignore All Highlights** cần xác nhận.
- **Manage Ignored Highlights**: xem item đã Ignore theo sách và dùng **Remove From Ignore List** hoặc **Remove All From Ignore List**. Xóa một Ignore không lập tức ghi lại note; highlight trở về luồng new-or-missing ở lần sync sau nếu nó vẫn còn trong `My Clippings.txt`.
- **Review Missing Highlights**: quyết định với highlight đã nhập trước đây nhưng không còn được tìm thấy trong ghi chú dự kiến.
- **View Books Left Unchanged**: xem sách được plugin bảo vệ vì không thể cập nhật an toàn.
- **Review Note Update Issues**: xem kết quả dọn Ignore bị lỗi hoặc không thể xác nhận.

## Missing Highlights

Một highlight chỉ được coi là bị thiếu khi tất cả điều kiện sau đều đúng:

1. `My Clippings.txt` hiện tại vẫn chứa highlight đó.
2. `data.json` có record imported-highlight khớp và đáng tin cậy cho lần sync này.
3. Marker chính xác của nó không được tìm thấy bên trong phần managed hợp lệ tại đường dẫn ghi chú sách dự kiến.

Kiểm tra chạy trong lần sync của người dùng quay lại, sau khi file Kindle được phân tích. Nếu ghi chú dự kiến không thể được đọc an toàn, plugin không tự động gọi highlight đó là bị thiếu.

Với mỗi highlight bị thiếu, bạn có thể chọn:

- **Import Again**: thử khôi phục. Item chỉ biến mất khỏi danh sách missing sau khi writer xác nhận kết quả an toàn; nếu không, nó vẫn ở đó để thử lại.
- **Ignore Going Forward**: lưu lựa chọn Ignore và giữ nó ngoài các lần sync sau. Record imported cũ vẫn còn; Ignore có ưu tiên cao hơn. Nếu sau này bạn xóa Ignore khi marker vẫn thiếu, highlight có thể quay lại trạng thái missing.
- **Skip This Time**: chỉ xóa khỏi phần tổng kết hiện tại. Không có gì được lưu nên item có thể quay lại ở lần sync sau.

Các lựa chọn tương đương ở cấp sách là **Import All Again**, **Ignore All Going Forward** và **Skip All This Time**.

Giới hạn: phát hiện missing phụ thuộc vào metadata imported đã lưu, clipping vẫn có trong file hiện tại, đường dẫn note dự kiến và một phần managed đọc được. Vì vậy, note bị di chuyển thủ công có thể trông như bị thiếu; còn highlight biến mất khỏi cả file Kindle hiện tại và dữ liệu định danh đáng tin cậy thì không thể được kiểm tra.

## Nếu một highlight bị xóa

### Bị xóa khỏi ghi chú Obsidian

Nếu bạn xóa thủ công một highlight do plugin quản lý nhưng vẫn giữ marker và phần còn lại của note hợp lệ, nó xuất hiện trong **Missing Highlights** ở lần sync sau khi record Import đã lưu và entry trong file Kindle vẫn còn. Xóa toàn bộ phần managed có thể làm mọi highlight đang được theo dõi của note đó xuất hiện là missing.

Sau đó, bạn có thể Import lại, Ignore về sau hoặc Skip lần này. Nội dung cá nhân bên ngoài marker managed không thuộc phép kiểm tra này.

### Bị xóa khỏi Kindle

Kindle Local Sync không có API xóa của Kindle. Plugin chỉ đọc `My Clippings.txt`, và thiết bị Kindle có thể giữ highlight đã xóa trong file đó.

- Nếu highlight đã xóa không còn trong `My Clippings.txt`, plugin không coi sự vắng mặt là quyền xóa bản sao trong Obsidian.
- Nếu nó vẫn còn trong `My Clippings.txt`, plugin vẫn thấy nó như một clipping bình thường. Tùy trạng thái đã lưu và note, nó có thể được cập nhật, review, Ignore hoặc hiển thị là missing.

Vì vậy, plugin không thể hứa phát hiện được mọi thao tác xóa trên thiết bị Kindle.

## Bảo vệ ghi chú cá nhân

Kindle Local Sync chỉ quản lý phần nằm giữa hai marker:

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

Phần managed có thể được làm mới trong lúc sync. Hãy đặt nội dung riêng trước hoặc sau marker. Nội dung bên ngoài marker được bảo toàn.

Nếu cấu trúc marker bị hỏng hoặc update sẽ loại bỏ một highlight managed hiện hữu mà không có quyền rõ ràng, plugin giữ nguyên note của sách thay vì đoán.

## Xử lý trùng lặp

Các bản sao hoàn toàn giống nhau của cùng một clipping chỉ được ghi một lần. Record mới dùng định danh SHA-256 đầy đủ `kls2-...`, nên các clipping khác nhau vẫn độc lập ngay cả khi ID 32-bit `kls-...` cũ của chúng collision.

Note và lựa chọn cũ chỉ được migrate từng phần sau khi một ID cũ cùng block vật lý hoặc state của nó khớp duy nhất với một clipping hiện tại. Nếu ID cũ bị mơ hồ trong cùng sách, sách đó và các quyết định đã lưu được giữ nguyên, phần tổng kết giải thích xung đột, còn sách không liên quan vẫn có thể tiếp tục.

Nếu hiện chỉ có một thành viên của collision cũ, plugin không thể biết lựa chọn Import hoặc Ignore trước đây nói đến highlight nào. Plugin giữ lại bằng chứng cũ; nếu highlight thứ hai xuất hiện về sau và làm lộ xung đột, note của sách được giữ nguyên để review.

Cảnh báo downgrade: các phiên bản đến `0.1.2` không an toàn trước collision và không hiểu định danh authoritative mới. Không dùng phiên bản cũ để ghi lại hoặc cleanup note/state đã được phiên bản này ghi.

## Quyền riêng tư

Toàn bộ xử lý highlight diễn ra cục bộ. Runtime source không có đường gọi network, cloud sync, analytics, telemetry, Amazon API hoặc Readwise API. Plugin không gửi nội dung highlight hay vault qua mạng.

Plugin đọc `My Clippings.txt` từ filesystem cục bộ và ghi Markdown cùng plugin state bên trong vault Obsidian. Cài đặt **Strict local only** được lưu, nhưng runtime hiện tại vẫn cục bộ ngay cả khi toggle thay đổi vì không có tính năng mạng nào.

## Khắc phục sự cố

- **Không tìm thấy My Clippings.txt**: kết nối Kindle bằng USB, rồi đặt đường dẫn tuyệt đối trong **My clippings.txt path**.
- **Không tìm thấy highlight**: kiểm tra file có entry Highlight hoặc Note, không chỉ có bookmark.
- **Lần sync sau không thay đổi**: đây là hành vi bình thường khi marker đã nhập vẫn còn.
- **Một sách bị giữ nguyên**: plugin không chứng minh được việc thay phần managed là an toàn. Kiểm tra marker và giữ backup trước khi sửa phần managed.
- **Existing Kindle notes found xuất hiện sau khi nâng cấp**: đây là bước kết nối lại dự kiến được mô tả trong [Sau khi nâng cấp từ phiên bản cũ](#sau-khi-nâng-cấp-từ-phiên-bản-cũ). Ghi chú hiện có của bạn được giữ nguyên.
- **Nội dung cá nhân nằm trong note được tạo**: chuyển nội dung ra ngoài marker `kindle-local-sync` để lần làm mới phần managed sau không thay thế nó.

## Tài liệu kỹ thuật

Xem [Kiến trúc kỹ thuật](docs/ARCHITECTURE.md) để đọc về kiến trúc, quy tắc sync state, persistence, safety invariants, giới hạn đã biết và bản đồ source/test.

## Roadmap

- Hoàn tất manual QA trên vault sạch cho các luồng new, returning, reconnect, missing, Ignore, Skip, cancel và managed region.
- Thay demo hiện tại bằng bản ghi đã xác minh an toàn quyền riêng tư.
- Xác minh release artifact có thể tái tạo và cài đặt trước khi phát hành.
