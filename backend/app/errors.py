class AppError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: dict | None = None,
    ) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.details = details if details is not None else {}
        super().__init__(message)
